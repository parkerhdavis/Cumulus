# media-pipeline

Scripts that drive the Blu-ray archival pipeline on **phd-server**: rip a disc to a
Tier-1 lossless archive, transcode it to the Tier-2 Jellyfin streaming master, and
generate a Tier-3 1080p compatibility proxy. Everything runs locally — the UHD drive
(`/dev/sr0`), MakeMKV, and ffmpeg are all on this host.

Full design lives in the Obsidian vault:
`40-59 PhD Projects/45 Other/Cumulus/30-39 Pipelines/30 Blu-ray Archival Pipeline.md`.

## Scripts

- **`rip-disc.sh`** (Tier 1) — rips the main feature of the inserted disc to
  `/mnt/vault-2/Archival/Movies/<Title (Year)>/<Title (Year)>.mkv` via the MakeMKV CLI,
  then hands off to `transcode-batch.sh`. Direct disc→MKV with an automatic
  `backup --decrypt` fallback for AACS 2.0 discs the direct pass can't handle.
- **`transcode-batch.sh`** (Tier 2) — walks `/mnt/vault-2/Archival/Movies/`, encodes each
  source MKV to HEVC (libx265, `-preset slow -crf 18`, HDR10 metadata auto-detected), and
  writes `<Title (Year)> - 2160p.mkv` into the matching `/mnt/vault-2/Jellyfin/Movies/`
  folder. Skips any title whose Jellyfin folder already has a `* - 2160p.mkv`.
- **`transcode-proxies.sh`** (Tier 3) — finds `*2160p*.mkv` (also `*4K*`/`*UHD*`) files in
  the Jellyfin library that lack a `- 1080p.mkv` sibling and encodes an H.264 1080p SDR
  proxy next to each (HDR sources tone-mapped to BT.709 via Hable). Idempotent and bounded
  per run. Runs unattended via **Ofelia** (see below), and can be run by hand.

The `- 2160p.mkv` / `- 1080p.mkv` suffixes are Jellyfin's multi-version convention: the two
files in a movie folder show up as selectable versions of the one title.

## One-command workflow (Tiers 1→2)

Insert a disc and run, naming it `"Title (Year)"`:

```bash
./rip-disc.sh "Arrival (2016)"
```

Scans the disc, rips the longest title to the archive, writes a `source.txt`, verifies the
file, ejects the disc, and starts the Tier-2 encode. The encode is CPU-bound and runs for
hours, so launch under tmux/nohup to disconnect:

```bash
tmux new -s rip './rip-disc.sh "Arrival (2016)"'
```

### Useful rip flags (`rip-disc.sh --help` for all)

- `--dry-run` — scan and report the title that would be ripped; write nothing.
- `--no-transcode` — rip only; prints the transcode command to run later.
- `--no-eject` / `--minlength SEC`.

## Tier-3 proxies (Ofelia)

The proxy job is scheduled by the `ofelia` service in `docker-compose.phd-server.yml`. On its
cron schedule Ofelia spawns an ephemeral `linuxserver/ffmpeg` container that runs
`transcode-proxies.sh` over the bind-mounted library. Config is rendered from
`ofelia/config.ini.template` by `make setup phd-server` (schedule, `MAX_FILES`, `CRF`, and
paths come from `.env` — `PROXY_*`).

Arm / operate it:

```bash
docker pull linuxserver/ffmpeg:latest     # required once: job config uses pull = false
make up phd-server                        # (or: docker compose ... up -d ofelia)
```

Run the proxy encoder by hand (host), e.g. a dry-run over the real library:

```bash
DRY_RUN=1 MEDIA_ROOT=/mnt/vault-2/Jellyfin \
  LOG_FILE=/tmp/proxy.log LOCK_FILE=/tmp/proxy.lock \
  ./transcode-proxies.sh
```

Tunables (env): `MAX_FILES` (default 2 encodes/run), `CRF` (18), `PRESET` (slow), `DRY_RUN`.

## Logs

- Ripping: `/mnt/vault-2/Archival/rip.log`
- Tier-2 transcoding: `/mnt/vault-2/Archival/Movies/transcode.log`
- Tier-3 proxies: `/mnt/vault-2/Archival/proxy-logs/proxy.log`
