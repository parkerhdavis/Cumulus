#!/usr/bin/env bash
# Walks each movie subfolder under SRC_ROOT, transcodes the source .mkv to
# HEVC, and writes the result into a matching subfolder under DST_ROOT (the
# Jellyfin library). The Archival side is read-only — originals are never
# touched. A movie is treated as already done if its Jellyfin destination
# folder contains any "* [x265].mkv" file.
#
# Usage: transcode-batch.sh [--dry-run] [--only "Folder Name"]
#
# Detection: presence of "* [x265].mkv" in the matching Jellyfin folder = skip.
# Output: <DST_ROOT>/<Folder>/<source basename> [x265].mkv

set -uo pipefail

SRC_ROOT="/mnt/vault-2/Archival/Movies"
DST_ROOT="/mnt/vault-2/Jellyfin/Movies"
LOG_FILE="$SRC_ROOT/transcode.log"
DRY_RUN=0
ONLY=""

# Reserve 2 cores so the rest of the machine stays responsive. ffmpeg gets
# -threads THREADS and x265 gets a matching pools= so neither layer of the
# pipeline grabs more than this cap.
THREADS=$(( $(nproc) - 2 ))
(( THREADS < 1 )) && THREADS=1

usage() {
	cat <<EOF
Usage: $(basename "$0") [--dry-run] [--only "Folder Name"]

  --dry-run         Show what would happen, do not run ffmpeg.
  --only TERM       Process only subfolders whose name contains TERM
                    (case-insensitive substring match, so --only arrival
                    matches "Arrival (2016)" and any other *Arrival* folders).
  -h, --help        Show this help.

Source : $SRC_ROOT  (Bluray extractions, never modified)
Dest   : $DST_ROOT  (Jellyfin library)
Log    : $LOG_FILE

For each subfolder under SRC_ROOT whose matching DST_ROOT folder does not
yet contain a "* [x265].mkv" file, transcodes the source .mkv to HEVC
(libx265 -preset slow -crf 18) with HDR10 metadata auto-detected via
ffprobe, and writes "<source basename> [x265].mkv" into the Jellyfin folder.
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--dry-run) DRY_RUN=1; shift ;;
		--only)    ONLY="${2:-}"; shift 2 ;;
		-h|--help) usage; exit 0 ;;
		*) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
	esac
done

log() {
	local ts msg
	ts=$(date '+%Y-%m-%d %H:%M:%S')
	msg="$*"
	printf '%s  %s\n' "$ts" "$msg" | tee -a "$LOG_FILE"
}

# Format an integer number of seconds as HH:MM:SS.
format_hms() {
	local s=$1
	(( s < 0 )) && s=0
	printf '%02d:%02d:%02d' $(( s / 3600 )) $(( (s % 3600) / 60 )) $(( s % 60 ))
}

# Source duration in whole seconds, or 0 on failure.
get_duration() {
	local src="$1"
	local d
	d=$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$src" 2>/dev/null)
	[[ -z "$d" || "$d" == "N/A" ]] && { echo 0; return; }
	# Round to nearest integer second
	awk -v x="$d" 'BEGIN{ printf "%d", x + 0.5 }'
}

# Reads ffmpeg's "-progress pipe:1" key=value stream on stdin and emits a
# log line every PROGRESS_INTERVAL seconds (and one final line at end).
# Args: total_duration_seconds, file_start_epoch.
progress_parser() {
	local duration="$1"
	local start_ts="$2"
	local interval=${PROGRESS_INTERVAL:-30}
	local last_emit=$start_ts
	local out_us=0
	local speed="?"
	local key value
	while IFS='=' read -r key value; do
		case "$key" in
			out_time_us) out_us="$value" ;;
			speed)       speed="$value" ;;
			progress)
				local now
				now=$(date +%s)
				if [[ "$value" == "end" ]] || (( now - last_emit >= interval )); then
					last_emit=$now
					local cur_s=$(( out_us / 1000000 ))
					local elapsed=$(( now - start_ts ))
					local pct=0
					(( duration > 0 )) && pct=$(( cur_s * 100 / duration ))
					local eta=0
					if (( cur_s > 0 && duration > cur_s )); then
						eta=$(( elapsed * (duration - cur_s) / cur_s ))
					fi
					log "  [${pct}%] encoded $(format_hms "$cur_s") / $(format_hms "$duration"), elapsed $(format_hms "$elapsed"), file ETA $(format_hms "$eta"), speed=$speed"
				fi
				[[ "$value" == "end" ]] && break
				;;
		esac
	done
}

# Emit the HDR fragment of x265-params for a source file, or empty string.
# Includes colorprim/transfer/colormatrix only when the source transfer is HDR
# (smpte2084 PQ or arib-std-b67 HLG). Includes master-display when the
# mastering-display side data is present, and max-cll only when the
# content-light-level values are non-zero (some encoders ship 0,0 which is
# meaningless and confuses downstream tools).
build_hdr_params() {
	local src="$1"
	local transfer primaries matrix
	transfer=$(ffprobe -v error -select_streams v:0 \
		-show_entries stream=color_transfer -of default=nw=1:nk=1 "$src" 2>/dev/null)

	case "$transfer" in
		smpte2084|arib-std-b67) ;;
		*) echo ""; return 0 ;;
	esac

	primaries=$(ffprobe -v error -select_streams v:0 \
		-show_entries stream=color_primaries -of default=nw=1:nk=1 "$src" 2>/dev/null)
	matrix=$(ffprobe -v error -select_streams v:0 \
		-show_entries stream=color_space -of default=nw=1:nk=1 "$src" 2>/dev/null)
	[[ -z "$primaries" || "$primaries" == "unknown" ]] && primaries="bt2020"
	[[ -z "$matrix"    || "$matrix"    == "unknown" ]] && matrix="bt2020nc"

	local probe
	probe=$(ffprobe -v error -select_streams v:0 \
		-read_intervals "%+#1" \
		-show_frames -show_entries frame=side_data_list \
		-of default=noprint_wrappers=1 "$src" 2>/dev/null) || probe=""

	local out=":colorprim=${primaries}:transfer=${transfer}:colormatrix=${matrix}"

	if grep -q "Mastering display metadata" <<<"$probe"; then
		local rx ry gx gy bx by wpx wpy minl maxl
		rx=$(awk -F'[=/]' '/^red_x=/{print $2; exit}'         <<<"$probe")
		ry=$(awk -F'[=/]' '/^red_y=/{print $2; exit}'         <<<"$probe")
		gx=$(awk -F'[=/]' '/^green_x=/{print $2; exit}'       <<<"$probe")
		gy=$(awk -F'[=/]' '/^green_y=/{print $2; exit}'       <<<"$probe")
		bx=$(awk -F'[=/]' '/^blue_x=/{print $2; exit}'        <<<"$probe")
		by=$(awk -F'[=/]' '/^blue_y=/{print $2; exit}'        <<<"$probe")
		wpx=$(awk -F'[=/]' '/^white_point_x=/{print $2; exit}'<<<"$probe")
		wpy=$(awk -F'[=/]' '/^white_point_y=/{print $2; exit}'<<<"$probe")
		minl=$(awk -F'[=/]' '/^min_luminance=/{print $2; exit}'<<<"$probe")
		maxl=$(awk -F'[=/]' '/^max_luminance=/{print $2; exit}'<<<"$probe")
		if [[ -n "$rx$ry$gx$gy$bx$by$wpx$wpy$minl$maxl" ]]; then
			out+=":master-display=G(${gx},${gy})B(${bx},${by})R(${rx},${ry})WP(${wpx},${wpy})L(${maxl},${minl})"
		fi
	fi

	if grep -q "Content light level metadata" <<<"$probe"; then
		local maxc maxa
		maxc=$(awk -F'=' '/^max_content=/{print $2; exit}' <<<"$probe")
		maxa=$(awk -F'=' '/^max_average=/{print $2; exit}' <<<"$probe")
		if [[ -n "$maxc" && -n "$maxa" && ( "$maxc" != "0" || "$maxa" != "0" ) ]]; then
			out+=":max-cll=${maxc},${maxa}"
		fi
	fi

	echo "$out"
}

transcode_one() {
	local src="$1"
	local dst="$2"
	local duration="$3"
	local tmp="${dst%.mkv}.partial.mkv"

	# log-level=error suppresses x265's own info banner, which bypasses
	# ffmpeg's loglevel and would otherwise pollute the terminal.
	local x265p="log-level=error:hdr10-opt=1:repeat-headers=1:pools=${THREADS}"
	local hdr
	hdr=$(build_hdr_params "$src")
	x265p+="$hdr"

	if (( DRY_RUN )); then
		log "DRY-RUN would transcode: $src"
		log "  -> $dst"
		log "  x265-params: $x265p"
		return 0
	fi

	mkdir -p "$(dirname "$dst")"

	log "START: $src (threads=$THREADS, nice=19, ionice=idle)"
	log "  x265-params: $x265p"

	# Clean any stale partial from a prior aborted run before starting.
	rm -f "$tmp"

	local file_start
	file_start=$(date +%s)

	# -nostats turns off ffmpeg's native one-line refresh; -progress pipe:1
	# emits structured key=value updates on stdout which we parse for
	# periodic progress logging.
	nice -n 19 ionice -c 3 \
			ffmpeg -hide_banner -loglevel error -nostats -y \
			-threads "$THREADS" \
			-i "$src" \
			-map 0:v:0 -map 0:a:0 -map 0:a:0 -map "0:s?" \
			-c:v libx265 -preset slow -crf 18 -profile:v main10 \
			-x265-params "$x265p" \
			-c:a:0 copy \
			-c:a:1 ac3 -b:a:1 640k -ac:a:1 6 \
			-c:s copy \
			-map_chapters 0 \
			-default_mode infer_no_subs \
			-progress pipe:1 \
			"$tmp" \
		| progress_parser "$duration" "$file_start"

	local ff_rc="${PIPESTATUS[0]}"
	if (( ff_rc == 0 )); then
		mv -f "$tmp" "$dst"
		log "DONE:  $dst"
		return 0
	else
		rm -f "$tmp"
		log "FAIL (rc=$ff_rc): $src"
		return "$ff_rc"
	fi
}

main() {
	[[ -d "$SRC_ROOT" ]] || { echo "Source dir not found: $SRC_ROOT" >&2; exit 1; }
	[[ -d "$DST_ROOT" ]] || { echo "Destination dir not found: $DST_ROOT" >&2; exit 1; }
	cd "$SRC_ROOT"

	command -v ffmpeg  >/dev/null || { echo "ffmpeg not found in PATH"  >&2; exit 1; }
	command -v ffprobe >/dev/null || { echo "ffprobe not found in PATH" >&2; exit 1; }

	log "===== Batch start (dry_run=$DRY_RUN${ONLY:+, only=\"$ONLY\"}) ====="

	# Pre-flight: walk subfolders, classify, build the work queue.
	local skipped=0 missing=0
	local -a q_src=() q_dst=() q_dur=()
	local q_total_dur=0

	shopt -s nullglob
	local d
	for d in */; do
		d="${d%/}"
		[[ -d "$d" ]] || continue
		[[ -n "$ONLY" && "${d,,}" != *"${ONLY,,}"* ]] && continue

		local dst_dir="$DST_ROOT/$d"

		# Already-done: matching Jellyfin folder contains a "* [x265].mkv" file.
		if [[ -d "$dst_dir" ]]; then
			local existing
			existing=$(find "$dst_dir" -maxdepth 1 -type f -name "* \[x265\].mkv" -print -quit)
			if [[ -n "$existing" ]]; then
				log "SKIP (already in Jellyfin): $d"
				skipped=$((skipped + 1))
				continue
			fi
		fi

		# Source: first top-level .mkv in the Archival subfolder.
		local src=""
		while IFS= read -r -d '' f; do
			src="$f"
			break
		done < <(find "$d" -maxdepth 1 -type f -name "*.mkv" -print0)

		if [[ -z "$src" ]]; then
			log "WARN no source .mkv in: $d"
			missing=$((missing + 1))
			continue
		fi

		local base dst dur
		base="$(basename "$src" .mkv)"
		dst="$dst_dir/${base} [x265].mkv"
		dur=$(get_duration "$src")

		q_src+=("$src")
		q_dst+=("$dst")
		q_dur+=("$dur")
		q_total_dur=$(( q_total_dur + dur ))
	done

	local n=${#q_src[@]}
	log "Queue: $n file(s), total source duration $(format_hms "$q_total_dur") (skipped=$skipped, missing=$missing)"

	# Iterate the queue with progress + ETA reporting.
	local i done_count=0 failed=0 cum_enc=0 cum_wall=0
	for (( i = 0; i < n; i++ )); do
		local src="${q_src[i]}"
		local dst="${q_dst[i]}"
		local dur="${q_dur[i]}"
		local idx=$(( i + 1 ))

		# Once we've finished at least one file, project queue ETA from the
		# running encoded:wall ratio. Before that we have no real data.
		local eta_msg=""
		if (( cum_enc > 0 )); then
			local remaining_enc=$(( q_total_dur - cum_enc ))
			# Avoid divide-by-zero on absurdly fast first file.
			(( remaining_enc < 0 )) && remaining_enc=0
			local eta_wall=$(( remaining_enc * cum_wall / cum_enc ))
			eta_msg=", queue ETA $(format_hms "$eta_wall")"
		fi

		log "FILE $idx/$n: $src (duration $(format_hms "$dur")$eta_msg)"

		local file_start file_end file_wall
		file_start=$(date +%s)
		if transcode_one "$src" "$dst" "$dur"; then
			file_end=$(date +%s)
			file_wall=$(( file_end - file_start ))
			(( file_wall < 1 )) && file_wall=1
			local ratio
			ratio=$(awk -v d="$dur" -v w="$file_wall" 'BEGIN{ printf "%.3f", d/w }')
			log "  finished in $(format_hms "$file_wall") (encoded ${ratio}x realtime)"
			cum_enc=$(( cum_enc + dur ))
			cum_wall=$(( cum_wall + file_wall ))
			done_count=$(( done_count + 1 ))
		else
			failed=$(( failed + 1 ))
		fi
	done

	local total=$(( n + skipped + missing ))
	log "===== Batch end: total=$total transcoded=$done_count skipped=$skipped failed=$failed missing=$missing ====="
}

main "$@"
