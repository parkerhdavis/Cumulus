#!/usr/bin/env bash
# Tier-3 compatibility proxies. Finds 2160p/4K/UHD source MKVs in the Jellyfin
# library that lack a 1080p sibling and encodes an H.264 1080p SDR proxy next to
# each, using Jellyfin's version-suffix naming (`<Title> - 1080p.mkv`). HDR
# sources are tone-mapped to BT.709 SDR (Hable). Idempotent, bounded per run,
# and safe to run repeatedly or unattended.
#
# Designed to run inside the Ofelia-spawned linuxserver/ffmpeg container with the
# media library bind-mounted at /media, but also runs on the host for testing via
# the env overrides below.
#
# Env (all optional):
#   MEDIA_ROOT   library root to scan               (default /media)
#   LOG_FILE     append per-file log here            (default /state/proxy.log)
#   LOCK_FILE    flock path                          (default /state/transcode-proxies.lock)
#   MAX_FILES    max encodes per run                 (default 2)
#   CRF          libx264 CRF                         (default 18)
#   PRESET       libx264 preset                      (default slow)
#   DRY_RUN      1 = list planned work, no encode    (default 0)
#
# Derives all state from the filesystem: "what to encode" = source files matching
# the resolution pattern that lack a `- 1080p.mkv` sibling. No database, no state
# file. Interrupted encodes leave a `*.tmp` that the next run cleans up.

set -uo pipefail

MEDIA_ROOT="${MEDIA_ROOT:-/media}"
LOG_FILE="${LOG_FILE:-/state/proxy.log}"
LOCK_FILE="${LOCK_FILE:-/state/transcode-proxies.lock}"
MAX_FILES="${MAX_FILES:-2}"
CRF="${CRF:-18}"
PRESET="${PRESET:-slow}"
DRY_RUN="${DRY_RUN:-0}"

# 1080p box; force_original_aspect_ratio=decrease fits any aspect inside it
# (16:9 -> 1920x1080, scope -> width-limited), force_divisible_by=2 keeps
# dimensions even for yuv420p. This is the aspect-safe realization of the
# brief's "1080p, don't exceed the long axis".
SCALE="scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2"

mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$LOCK_FILE")" 2>/dev/null || true

log() {
	printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"
}

command -v ffmpeg  >/dev/null 2>&1 || { echo "ffmpeg not found in PATH"  >&2; exit 1; }
command -v ffprobe >/dev/null 2>&1 || { echo "ffprobe not found in PATH" >&2; exit 1; }

# Deprioritize the encode where the tools exist. The minimal container image may
# lack ionice (and even nice), so probe rather than assume.
NICE=""
command -v nice   >/dev/null 2>&1 && NICE="nice -n 19"
command -v ionice >/dev/null 2>&1 && NICE="$NICE ionice -c 3"

# Single-instance lock when flock is available (host). Inside the linuxserver
# container flock may be absent — Ofelia's `no-overlap = true` is the real guard
# there, so we degrade gracefully rather than fail.
if command -v flock >/dev/null 2>&1; then
	exec 9>"$LOCK_FILE" 2>/dev/null || true
	if ! flock -n 9; then
		log "Another run holds the lock ($LOCK_FILE); exiting."
		exit 0
	fi
fi

[[ -d "$MEDIA_ROOT" ]] || { echo "Media root not found: $MEDIA_ROOT" >&2; exit 1; }

# Height of the primary video stream, or 0 on failure.
video_height() {
	ffprobe -v error -select_streams v:0 -show_entries stream=height \
		-of default=nk=1:nw=1 "$1" 2>/dev/null | head -n1
}

# "hdr" if the primary video transfer is PQ or HLG, else "sdr".
hdr_kind() {
	local t
	t=$(ffprobe -v error -select_streams v:0 -show_entries stream=color_transfer \
		-of default=nk=1:nw=1 "$1" 2>/dev/null | head -n1)
	case "$t" in
		smpte2084|arib-std-b67) echo "hdr" ;;
		*) echo "sdr" ;;
	esac
}

# Normalize a source stem to the 1080p sibling name: replace a trailing
# " - 2160p"/"4K"/"UHD" with " - 1080p"; if none present, append " - 1080p".
proxy_stem() {
	local stem="$1" out
	out=$(sed -E 's/[[:space:]]*-[[:space:]]*(2160p|4K|UHD)[[:space:]]*$/ - 1080p/I' <<<"$stem")
	[[ "$out" == "$stem" ]] && out="$stem - 1080p"
	echo "$out"
}

human() { numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "${1}B"; }

# --- start of run ---------------------------------------------------------

log "===== Proxy run start (media=$MEDIA_ROOT, max=$MAX_FILES, dry_run=$DRY_RUN) ====="

# Clean abandoned .tmp files from crashed prior runs (older than 24h).
while IFS= read -r -d '' t; do
	log "Removing stale tmp: $t"
	(( DRY_RUN )) || rm -f "$t"
done < <(find "$MEDIA_ROOT" -type f -name '* - 1080p.mkv.tmp' -mmin +1440 -print0 2>/dev/null)

# Build the work queue: 2160p/4K/UHD sources lacking a 1080p sibling and
# actually taller than 1080.
declare -a queue=()
declare -a skipped=()
while IFS= read -r -d '' src; do
	dir=$(dirname "$src")
	stem=$(basename "$src" .mkv)
	dst="$dir/$(proxy_stem "$stem").mkv"

	[[ -f "$dst" ]] && continue                    # already has a 1080p sibling
	h=$(video_height "$src"); h=${h:-0}
	if [[ ! "$h" =~ ^[0-9]+$ ]] || (( h <= 1080 )); then
		skipped+=("$src (height=${h:-?} ≤ 1080)")
		continue
	fi
	queue+=("$src")
done < <(find "$MEDIA_ROOT" -type f \
	\( -iname '*2160p*.mkv' -o -iname '*4k*.mkv' -o -iname '*uhd*.mkv' \) \
	! -iname '* - 1080p.mkv' ! -iname '*.tmp' -print0 2>/dev/null | sort -z)

log "Candidates needing a proxy: ${#queue[@]} (skipped ${#skipped[@]} at/below 1080p)"
for s in "${skipped[@]}"; do log "  skip: $s"; done

if (( ${#queue[@]} == 0 )); then
	log "Nothing to do."
	log "===== Proxy run end ====="
	exit 0
fi

processed=0
for src in "${queue[@]}"; do
	(( processed >= MAX_FILES )) && { log "Per-run cap ($MAX_FILES) reached; $(( ${#queue[@]} - processed )) more for a later run."; break; }

	dir=$(dirname "$src")
	stem=$(basename "$src" .mkv)
	dst="$dir/$(proxy_stem "$stem").mkv"
	tmp="$dst.tmp"
	kind=$(hdr_kind "$src")
	src_bytes=$(stat -c %s "$src" 2>/dev/null || echo 0)

	if (( DRY_RUN )); then
		log "DRY-RUN would encode [$kind, $(human "$src_bytes")]: $src"
		log "  -> $dst"
		processed=$((processed + 1))
		continue
	fi

	rm -f "$tmp"
	log "START [$kind, $(human "$src_bytes")]: $src"
	start=$(date +%s)

	vf="$SCALE,format=yuv420p"
	[[ "$kind" == "hdr" ]] && vf="zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,$SCALE,format=yuv420p"

	if $NICE ffmpeg -hide_banner -loglevel error -nostdin -nostats -y \
			-i "$src" \
			-map 0:v:0 -map 0:a:0 -map 0:a:0 -map "0:s?" \
			-vf "$vf" \
			-c:v libx264 -preset "$PRESET" -crf "$CRF" \
			-c:a:0 ac3 -b:a:0 640k -ac:a:0 6 \
			-c:a:1 aac -b:a:1 192k -ac:a:1 2 \
			-c:s copy \
			-map_chapters 0 \
			-metadata:s:a:0 title="Surround 5.1" \
			-metadata:s:a:1 title="Stereo" \
			"$tmp"
	then
		mv -f "$tmp" "$dst"
		elapsed=$(( $(date +%s) - start ))
		out_bytes=$(stat -c %s "$dst" 2>/dev/null || echo 0)
		log "DONE ($(( elapsed / 60 ))m$(( elapsed % 60 ))s, $(human "$src_bytes") -> $(human "$out_bytes")): $dst"
		processed=$((processed + 1))
	else
		rc=$?
		rm -f "$tmp"
		log "FAIL (rc=$rc): $src"
	fi
done

log "===== Proxy run end: encoded $processed this run ====="
