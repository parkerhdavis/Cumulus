# Headless Obsidian Sync client (https://obsidian.md/help/sync/headless).
#
# obsidian-headless has no official image, so this bakes the npm CLI onto Node
# 22 (its better-sqlite3 dependency ships a prebuilt binary for Debian glibc,
# so no compiling). The ob CLI insists on its config living under
# ~/.config/obsidian-headless (auth_token + sync/<vault-id>/config.json), so
# HOME points at /state and the named volume mounted there makes login and
# per-vault setup survive container recreation.
#
# The container starts as root solely to repair ownership — Docker
# auto-creates missing bind sources as root:root, which would lock the sync
# user out of its own vault — and the entrypoint immediately drops to the
# host user (OBSIDIAN_UID/GID env, default 1000:1000, via gosu; same values
# as the compose services previously set with user:). Every ob invocation
# runs as that user, so synced files are owned by the user, never root. If
# it changes, also change the chown here and remove the state volume once so
# it re-initializes with the new ownership.
#
# Built on first `make up <host>` by the compose `build:` key.
FROM node:22-slim
ARG OBSIDIAN_HEADLESS_VERSION=0.0.14

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends gosu \
	&& rm -rf /var/lib/apt/lists/* \
	&& npm install --global obsidian-headless@${OBSIDIAN_HEADLESS_VERSION} \
	&& mkdir -p /state \
	&& chown 1000:1000 /state

ENV HOME=/state
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]