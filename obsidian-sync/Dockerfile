# Headless Obsidian Sync client (https://obsidian.md/help/sync/headless).
#
# obsidian-headless has no official image, so this bakes the npm CLI onto Node
# 22 (its better-sqlite3 dependency ships a prebuilt binary for Debian glibc,
# so no compiling). The ob CLI insists on its config living under
# ~/.config/obsidian-headless (auth_token + sync/<vault-id>/config.json), so
# HOME points at /state and the named volume mounted there makes login and
# per-vault setup survive container recreation.
#
# Runs as the host user so synced files are owned by that user, not root (the
# compose service pins user: 1000:1000; OBSIDIAN_UID/GID overrides it — if it
# changes, also change the chown here and remove the state volume once so it
# re-initializes with the new ownership).
#
# Built on first `make up <host>` by the compose `build:` key.
FROM node:22-slim
ARG OBSIDIAN_HEADLESS_VERSION=0.0.14

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
	&& npm install --global obsidian-headless@${OBSIDIAN_HEADLESS_VERSION} \
	&& mkdir -p /state \
	&& chown 1000:1000 /state

ENV HOME=/state
USER 1000:1000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]