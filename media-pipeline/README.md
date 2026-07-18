# media-pipeline

Scripts that drive the Blu-ray archival pipeline on **phd-server**: rip a disc to a
Tier-1 lossless archive, then transcode it into the Tier-2 Jellyfin encode. Both run
locally — the UHD drive (`/dev/sr0`), MakeMKV, and ffmpeg are all on this host.

Full design lives in the Obsidian vault:
`40-59 PhD Projects/45 Other/Cumulus/30-39 Pipelines/30 Blu-ray Archival Pipeline.md`.

## Scripts

- **`rip-disc.sh`** — rips the main feature of the inserted disc to
  `/mnt/vault-2/Archival/Movies/<Title (Year)>/<Title (Year)>.mkv` via the MakeMKV CLI,
  then (by default) hands off to `transcode-batch.sh`. Tries a direct disc→MKV rip and
  falls back to `backup --decrypt` → extract-from-backup if the direct pass fails.
- **`transcode-batch.sh`** — walks `/mnt/vault-2/Archival/Movies/`, encodes each source
  MKV to HEVC (libx265, `-preset slow -crf 18`, HDR10 metadata auto-detected), and writes
  `<name> [x265].mkv` into the matching `/mnt/vault-2/Jellyfin/Movies/` folder. Skips any
  title whose Jellyfin folder already has a `* [x265].mkv`.

## One-command workflow

Insert a disc and run, naming it `"Title (Year)"`:

```bash
./rip-disc.sh "Arrival (2016)"
```

That scans the disc, rips the longest title to the archive, writes a `source.txt`
breadcrumb, verifies the file, ejects the disc, and starts the Tier-2 encode.

The encode is CPU-bound and runs for hours, so launch under tmux/nohup if you want to
disconnect:

```bash
tmux new -s rip './rip-disc.sh "Arrival (2016)"'
```

### Useful flags (`rip-disc.sh --help` for all)

- `--dry-run` — scan and report the title that would be ripped; write nothing.
- `--no-transcode` — rip only; prints the transcode command to run later.
- `--no-eject` — leave the disc in the drive.
- `--minlength SEC` — minimum title length considered during the scan (default 120).

`transcode-batch.sh` can also be run on its own — `./transcode-batch.sh --dry-run` to
preview the queue, or `--only "Arrival"` to encode a single title.

## Logs

- Ripping: `/mnt/vault-2/Archival/rip.log`
- Transcoding: `/mnt/vault-2/Archival/transcode.log`
