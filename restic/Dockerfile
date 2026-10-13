FROM alpine:3.20

# restic does the backup, the Postgres client produces the fresh forgejo-db
# dump over the compose network (pg_dump's major must match the server's),
# zstd compresses the dump, and busybox crond provides the monthly schedule —
# no Docker socket mount and no separate scheduler service this way.
RUN apk add --no-cache restic postgresql16-client bash zstd

COPY backup.sh /backup.sh
COPY crontabs/root /etc/crontabs/root
RUN chmod +x /backup.sh

CMD ["crond", "-f", "-l", "8"]