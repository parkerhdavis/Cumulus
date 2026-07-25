# The image the Tier-3 proxy job runs in. linuxserver/ffmpeg already bundles
# every tool the job needs (ffmpeg, ffprobe, bash, flock, find, nice/ionice,
# numfmt), but its entrypoint is /ffmpegwrapper.sh, which always execs ffmpeg —
# and Ofelia's job-run cannot override a container entrypoint. So we bake a bash
# entrypoint here; the Ofelia job's `command` is then just the script path.
#
# Built as cumulus/proxy-encoder:latest by `make setup phd-server`; the Ofelia
# job references it with pull = false (it's a local-only tag).
FROM linuxserver/ffmpeg:latest
ENTRYPOINT ["/bin/bash"]
