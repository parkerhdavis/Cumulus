#!/bin/bash
# Monthly backup of the tower to the DigitalOcean Spaces cold bucket — the
# design lives in the Software-Wiki (50 Cumulus, 90-99 Agents/Transient, phd-tower
# Backup Design). Three tagged roots in one restic repository:
#
#   forge-data  /media/parker/ForgeData — the forge's git packs, LFS objects,
#               app data and SSH host keys: the origin of record for hosted code
#   db-dump     a fresh pg_dump of the forgejo database, snapshotted moments
#               after it is written (accounts/issues/metadata — the state
#               outside the git trees)
#   home        /home/parker — the vault copies, dotfiles, the small trees
#
# Retention keeps a rolling year of monthlies plus three annual keepers; at
# monthly cadence forget's deletions fall inside the cold bucket's free
# early-deletion tier (first 250 GiB/month).
#
# The image runs unattended under crond; DOCKER log tails the /backup.log.

set -euo pipefail

# Hard guard so an unplugged (placeholder) configuration fails immediately and
# legibly on its first cron firing rather than after an upload attempt.
: "${RESTIC_REPOSITORY:?backup not plugged in: BACKUP_REPOSITORY is not set in .env}"
: "${RESTIC_PASSWORD:?backup not plugged in: BACKUP_PASSWORD is not set in .env}"
: "${AWS_ACCESS_KEY_ID:?backup not plugged in: BACKUP_S3_KEY is not set in .env}"
: "${AWS_SECRET_ACCESS_KEY:?backup not plugged in: BACKUP_S3_SECRET is not set in .env}"

# 1. A fresh dump of the forge database.
mkdir -p /backups
rm -f /backups/forgejo-db.sql.zst
if pg_dump -h "${FORGEJO_DB_HOST:-forgejo-db}" -U forgejo | zstd -T0 > /backups/forgejo-db.sql.zst; then
	echo "pg_dump ok: $(du -h /backups/forgejo-db.sql.zst | cut -f1)"
else
	echo "pg_dump FAILED — aborting before any upload" >&2
	exit 1
fi

# 2. Snapshots.
restic backup --tag forge-data --one-file-system /forge-data
restic backup --tag db-dump --one-file-system /backups
restic backup --tag home --one-file-system /home/parker \
	--exclude '/home/parker/.cache' \
	--exclude '/home/parker/**/node_modules' \
	--exclude '/home/parker/**/__pycache__'

# 3. Retention: rolling year of monthlies, three annual keepers.
restic forget --prune --max-unused 5% --keep-monthly 12 --keep-yearly 3

# 4. Teeth: this run only means something if it produced a snapshot today.
restic snapshots --latest 1 --tag home > /dev/null
echo "backup run complete"