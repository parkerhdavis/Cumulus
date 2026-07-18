#!/usr/bin/env bash
# Rips the main feature of an inserted Blu-ray / UHD disc to a Tier-1 archival
# MKV via the MakeMKV CLI, then (by default) hands off to transcode-batch.sh to
# produce the Tier-2 Jellyfin encode. The intended flow is "insert disc, run one
# command, walk away."
#
# Pipeline context: see the Blu-ray Archival Pipeline doc in the Obsidian vault.
#   Tier 1 (this script): lossless MKV in /mnt/vault-2/Archival/Movies/<Title>/
#   Tier 2 (transcode-batch.sh): HEVC encode in /mnt/vault-2/Jellyfin/Movies/<Title>/
#
# Rip strategy: try a direct disc->MKV rip first (modern MakeMKV + a LibreDrive-
# capable drive handles AACS 2.0 in one pass). If that fails, fall back to the
# classic two-step backup --decrypt -> extract-from-backup path, cleaning up the
# transient backup folder afterward.
#
# Usage: rip-disc.sh [options] ["Title (Year)"]
#   See --help.

set -uo pipefail

SRC_ROOT="/mnt/vault-2/Archival/Movies"
TMP_ROOT="/mnt/vault-2/Archival/.tmp"
LOG_FILE="/mnt/vault-2/Archival/rip.log"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRANSCODE="$SCRIPT_DIR/transcode-batch.sh"

DRIVE=0                 # MakeMKV disc index
DEV="/dev/sr0"          # optical device (used for eject)
MINLENGTH=120           # min title length (s) considered during the scan
DO_TRANSCODE=1
DO_EJECT=1
DRY_RUN=0
TITLE=""                # "Title (Year)" from the CLI, if given

usage() {
	cat <<EOF
Usage: $(basename "$0") [options] ["Title (Year)"]

Rips the main feature of the inserted disc to a Tier-1 archival MKV, then (unless
--no-transcode) kicks off the Tier-2 Jellyfin encode via transcode-batch.sh.

Arguments:
  "Title (Year)"    Name for the archive folder and main-feature file, e.g.
                    "Arrival (2016)". If omitted, the disc's volume label is used
                    and a warning is printed (rename the folder/file afterward).

Options:
  --drive N         MakeMKV disc index (default $DRIVE).
  --dev PATH        Optical device for eject (default $DEV).
  --minlength SEC   Minimum title length considered when scanning (default $MINLENGTH).
  --no-transcode    Rip only; do not start the Tier-2 encode. Prints the command
                    to run it later.
  --no-eject        Leave the disc in the drive when finished.
  --dry-run         Scan the disc and report the title that would be ripped, then
                    stop. Writes nothing.
  -h, --help        Show this help.

Source : disc:$DRIVE ($DEV)
Archive: $SRC_ROOT/<Title (Year)>/<Title (Year)>.mkv
Log    : $LOG_FILE

The auto-chained Tier-2 encode is CPU-bound and runs for hours. Launch this under
tmux or nohup if you want to disconnect:  tmux new -s rip '$(basename "$0") "Title (Year)"'
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--drive)        DRIVE="${2:-}"; shift 2 ;;
		--dev)          DEV="${2:-}"; shift 2 ;;
		--minlength)    MINLENGTH="${2:-}"; shift 2 ;;
		--no-transcode) DO_TRANSCODE=0; shift ;;
		--no-eject)     DO_EJECT=0; shift ;;
		--dry-run)      DRY_RUN=1; shift ;;
		-h|--help)      usage; exit 0 ;;
		--*)            echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
		*)
			if [[ -z "$TITLE" ]]; then
				TITLE="$1"; shift
			else
				echo "unexpected extra argument: $1" >&2; usage >&2; exit 2
			fi
			;;
	esac
done

log() {
	local ts msg
	ts=$(date '+%Y-%m-%d %H:%M:%S')
	msg="$*"
	printf '%s  %s\n' "$ts" "$msg" | tee -a "$LOG_FILE"
}

format_hms() {
	local s=$1
	(( s < 0 )) && s=0
	printf '%02d:%02d:%02d' $(( s / 3600 )) $(( (s % 3600) / 60 )) $(( s % 60 ))
}

# Filter raw makemkvcon robot output on stdin into human-friendly log lines:
# surface MSG text and a throttled progress percentage from PRGV.
filter_robot() {
	local line msg rest cur tot max pct last_pct=-100 op=""
	while IFS= read -r line; do
		case "$line" in
			MSG:*)
				# MSG:code,flags,count,"message",...  -- message is the 1st quoted field
				msg=$(sed -E 's/^MSG:[0-9]+,[0-9]+,[0-9]+,"([^"]*)".*/\1/' <<<"$line")
				[[ -n "$msg" && "$msg" != "$line" ]] && log "  mk: $msg"
				;;
			PRGC:*)
				# PRGC:code,id,"name" -- a new current operation begins; note its
				# name and reset the throttle so this phase's 0->100 is shown.
				op=$(sed -E 's/^PRGC:[0-9]+,[0-9]+,"([^"]*)".*/\1/' <<<"$line")
				[[ "$op" == "$line" ]] && op=""
				last_pct=-100
				;;
			PRGV:*)
				# PRGV:current,total,max -- "total" tracks the current phase 0..max.
				rest="${line#PRGV:}"
				IFS=',' read -r cur tot max <<<"$rest"
				[[ "$max" =~ ^[0-9]+$ && "$max" -gt 0 ]] || continue
				pct=$(( tot * 100 / max ))
				if (( pct >= last_pct + 5 )); then
					last_pct=$pct
					log "  mk: ${op:+$op }progress ${pct}%"
				fi
				;;
		esac
	done
}

# Best-effort disc volume label for the given drive index. Empty if none.
disc_label() {
	local out rest idx vis en fl names label
	out=$(makemkvcon -r --cache=1 info disc:9999 2>/dev/null | grep "^DRV:$DRIVE," | head -n1)
	[[ -z "$out" ]] && return 0
	rest="${out#DRV:}"
	# First 4 fields are bare integers; the remainder is "drive","disc","device".
	IFS=',' read -r idx vis en fl names <<<"$rest"
	label=$(sed -E 's/^"[^"]*","([^"]*)".*/\1/' <<<"$names")
	echo "$label"
}

# Scan a MakeMKV source specifier (disc:N or file:PATH) and echo the longest
# title as: "<title_index>\t<seconds>\t<H:MM:SS>". Empty output = no titles.
scan_longest() {
	local src="$1"
	makemkvcon -r --cache=1 --minlength="$MINLENGTH" info "$src" 2>/dev/null \
		| awk -F',' '
			/^TINFO:/ && $2==9 {
				tid=$1; sub(/^TINFO:/,"",tid)
				dur=$4; gsub(/"/,"",dur)
				n=split(dur,t,":")
				secs=(n==3)?t[1]*3600+t[2]*60+t[3]:(n==2)?t[1]*60+t[2]:t[1]
				if (secs>maxsecs){maxsecs=secs; maxid=tid; maxdur=dur}
			}
			END{ if(maxid!="") printf "%s\t%s\t%s\n", maxid, maxsecs, maxdur }
		'
}

# After a rip, find the single produced MKV in $1 and rename it to $2. If the
# target already exists we leave it; if several MKVs exist we rename the largest.
finalize_output() {
	local dir="$1" target="$2"
	if [[ -f "$dir/$target" ]]; then
		log "Main feature already named: $target"
		return 0
	fi
	local -a mkvs=()
	local f
	while IFS= read -r -d '' f; do mkvs+=("$f"); done \
		< <(find "$dir" -maxdepth 1 -type f -name '*.mkv' -print0)
	if (( ${#mkvs[@]} == 0 )); then
		log "ERROR: no .mkv produced in $dir"
		return 1
	fi
	local pick="${mkvs[0]}"
	if (( ${#mkvs[@]} > 1 )); then
		log "WARN: ${#mkvs[@]} MKVs present; picking the largest as the main feature"
		pick=$(find "$dir" -maxdepth 1 -type f -name '*.mkv' -printf '%s\t%p\n' \
			| sort -rn | head -n1 | cut -f2-)
	fi
	mv -f "$pick" "$dir/$target"
	log "Renamed main feature -> $target"
}

# ffprobe sanity check: video stream present and duration > 0.
verify_output() {
	local f="$1" vcodec dur
	vcodec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name \
		-of default=nk=1:nw=1 "$f" 2>/dev/null | head -n1)
	dur=$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$f" 2>/dev/null)
	if [[ -n "$vcodec" && -n "$dur" && "$dur" != "N/A" ]]; then
		log "Verify OK: video=$vcodec, duration=$(format_hms "${dur%.*}")"
		return 0
	fi
	log "Verify FAILED: could not read a video stream/duration from $f"
	return 1
}

# --------------------------------------------------------------------------

main() {
	command -v makemkvcon >/dev/null || { echo "makemkvcon not found in PATH" >&2; exit 1; }
	command -v ffprobe    >/dev/null || { echo "ffprobe not found in PATH"    >&2; exit 1; }
	command -v eject      >/dev/null || DO_EJECT=0
	[[ -d "$SRC_ROOT" ]] || { echo "Archive root not found: $SRC_ROOT" >&2; exit 1; }
	[[ -x "$TRANSCODE" ]] || { echo "transcode script not found/executable: $TRANSCODE" >&2; DO_TRANSCODE=0; }
	[[ "$MINLENGTH" =~ ^[0-9]+$ ]] || { echo "--minlength must be an integer" >&2; exit 2; }

	log "===== Rip start (drive=$DRIVE, dry_run=$DRY_RUN${TITLE:+, title=\"$TITLE\"}) ====="

	local label
	label=$(disc_label)
	[[ -n "$label" ]] && log "Disc label: $label"

	# Resolve the archive name.
	local name="$TITLE"
	if [[ -z "$name" ]]; then
		if [[ -n "$label" ]]; then
			name="$label"
			log "WARN: no title given; using disc label \"$name\" -- rename the folder/file afterward."
		else
			echo "No title given and no disc label detected. Pass a name, e.g.:" >&2
			echo "  $(basename "$0") \"Arrival (2016)\"" >&2
			exit 2
		fi
	fi
	if [[ "$name" == */* ]]; then
		echo "Title must not contain '/': \"$name\"" >&2
		echo "Use a filesystem-safe name (e.g. 'Frost-Nixon (2008)')." >&2
		exit 2
	fi
	local archive_dir="$SRC_ROOT/$name"

	# Authoritative presence check: scan the disc for titles.
	log "Scanning disc:$DRIVE for titles (minlength=${MINLENGTH}s)..."
	local scan idx secs dur
	scan=$(scan_longest "disc:$DRIVE")
	if [[ -z "$scan" ]]; then
		echo "No readable titles found on disc:$DRIVE." >&2
		echo "Is a supported Blu-ray/DVD inserted in $DEV?" >&2
		log "ABORT: no readable titles (no disc / unsupported / unreadable)."
		exit 1
	fi
	IFS=$'\t' read -r idx secs dur <<<"$scan"
	log "Main feature: title $idx, runtime $dur ($secs s)"

	if (( DRY_RUN )); then
		log "DRY-RUN: would rip title $idx -> $archive_dir/$name.mkv"
		(( DO_TRANSCODE )) && log "DRY-RUN: would then run: $TRANSCODE --only \"$name\""
		log "===== Rip end (dry-run) ====="
		exit 0
	fi

	mkdir -p "$archive_dir"
	local method="direct"

	# --- Attempt 1: direct disc -> MKV ---
	log "Ripping (direct) title $idx to $archive_dir ..."
	makemkvcon -r --progress=-same --messages=-stdout \
		--decrypt --cache=1024 --minlength="$MINLENGTH" \
		mkv "disc:$DRIVE" "$idx" "$archive_dir" 2>&1 | filter_robot
	local rc=${PIPESTATUS[0]}

	# Consider it a success only if makemkvcon returned 0 AND an MKV appeared.
	local produced
	produced=$(find "$archive_dir" -maxdepth 1 -type f -name '*.mkv' -print -quit)
	if (( rc != 0 )) || [[ -z "$produced" ]]; then
		log "Direct rip failed (rc=$rc). Falling back to backup --decrypt -> extract."
		method="backup"
		local tmp="$TMP_ROOT/$name"
		rm -rf "$tmp"; mkdir -p "$tmp"

		log "Backing up (decrypting) disc:$DRIVE to $tmp ..."
		makemkvcon -r --progress=-same --messages=-stdout \
			--decrypt --noscan --cache=16 \
			backup "disc:$DRIVE" "$tmp" 2>&1 | filter_robot
		local brc=${PIPESTATUS[0]}
		if (( brc != 0 )); then
			log "FAIL: backup step failed (rc=$brc). Leaving $tmp for inspection."
			exit "$brc"
		fi

		log "Re-scanning backup for the main title..."
		local bscan bidx bsecs bdur
		bscan=$(scan_longest "file:$tmp")
		if [[ -z "$bscan" ]]; then
			log "FAIL: no titles found in backup at $tmp."
			exit 1
		fi
		IFS=$'\t' read -r bidx bsecs bdur <<<"$bscan"
		log "Backup main feature: title $bidx, runtime $bdur"

		log "Extracting title $bidx from backup to $archive_dir ..."
		makemkvcon -r --progress=-same --messages=-stdout \
			--minlength="$MINLENGTH" \
			mkv "file:$tmp" "$bidx" "$archive_dir" 2>&1 | filter_robot
		local mrc=${PIPESTATUS[0]}
		if (( mrc != 0 )); then
			log "FAIL: extract-from-backup failed (rc=$mrc). Leaving $tmp for inspection."
			exit "$mrc"
		fi

		log "Removing transient backup folder $tmp"
		rm -rf "$tmp"
	fi

	# Name the main feature and sanity-check it.
	finalize_output "$archive_dir" "$name.mkv" || exit 1
	verify_output "$archive_dir/$name.mkv" || log "WARN: verification failed; inspect the file before relying on it."

	# source.txt breadcrumb (matches the pipeline doc's optional-metadata block).
	local mkv_ver
	mkv_ver=$(makemkvcon -r --cache=1 info disc:9999 2>/dev/null \
		| sed -nE 's/^MSG:1005.*"(MakeMKV v[^"]*) started".*/\1/p' | head -n1)
	{
		echo "Name: $name"
		[[ -n "$label" ]] && echo "Disc Label: $label"
		echo "Rip Date: $(date '+%Y-%m-%d')"
		echo "Rip Method: $method"
		[[ -n "$mkv_ver" ]] && echo "MakeMKV Version: ${mkv_ver#MakeMKV }"
		echo "Source: Personal collection"
	} > "$archive_dir/source.txt"
	log "Wrote $archive_dir/source.txt"

	if (( DO_EJECT )); then
		log "Ejecting $DEV"
		eject "$DEV" 2>/dev/null || log "WARN: eject failed (disc may be in use)."
	fi

	log "===== Rip end: $archive_dir/$name.mkv (method=$method) ====="

	# --- Hand off to Tier-2 transcode ---
	if (( DO_TRANSCODE )); then
		log "Handing off to Tier-2 transcode: $TRANSCODE --only \"$name\""
		"$TRANSCODE" --only "$name"
	else
		log "Rip-only mode. To encode Tier-2 later, run:"
		log "  $TRANSCODE --only \"$name\""
	fi
}

main "$@"
