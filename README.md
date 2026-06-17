# Cumulus

Self-hosted services running on personal infrastructure, managed with Docker Compose. Nothing too fancy or novel; I just wanted to share how I coordinate some of my favorite self-hosting services.

## Services

The stack is split across two hosts, each with its own compose file:

**Droplet** (DigitalOcean VPS) is the public-facing edge:

| Service | Description |
|---------|-------------|
| **[Pangolin](https://github.com/fosrl/pangolin)** | Reverse proxy & tunnel management |
| **[Gerbil](https://github.com/fosrl/gerbil)** | WireGuard tunnel agent for Pangolin |
| **[Traefik](https://github.com/traefik/traefik)** | Edge router handling HTTPS termination and routing |

**phd-server** (home server) is where the actual applications run:

| Service | Description |
|---------|-------------|
| **[Newt](https://github.com/fosrl/newt)** | Tunnel agent that connects back to Pangolin |
| **[Jellyfin](https://github.com/jellyfin/jellyfin)** | Media server for movies, TV, music |
| **[Immich](https://github.com/immich-app/immich)** | Self-hosted photo & video management |
| **Immich ML** | Machine learning sidecar for face/object recognition |
| **Immich Redis** | Caching layer for Immich (Valkey) |
| **Immich Database** | PostgreSQL with vector extensions for Immich search |
| **[Open WebUI](https://github.com/open-webui/open-webui)** | LLM chat interface with model management |
| **[Ollama](https://github.com/ollama/ollama)** | Local LLM inference engine |
| **[Perforce Helix Core](https://www.perforce.com/products/helix-core)** | Version control server |
| **[Websidian](websidian/)** | Custom web-based viewer for Obsidian vaults |
| **[Zulip](https://github.com/zulip/docker-zulip)** | Team chat (server + Postgres / RabbitMQ / Redis / Memcached sidecars) |
| **[Kitsu](https://kitsu.cg-wire.com/)** | Production tracker for CG/animation (locally-built Kitsu frontend + Zou API/event/jobs + Postgres / Redis / Meilisearch) |

### How it all fits together

On the Droplet: Pangolin, Gerbil, and Traefik run on a small cloud VPS and act as the public entry point with whatever auth/routing controls I need. Traefik terminates HTTPS and Gerbil manages WireGuard tunnels. On the home server, Newt establishes an outbound tunnel back to the Pangolin endpoint, so services like Jellyfin and Immich are reachable from the internet without exposing the home network or forwarding ports on the router.

On the Server: 

- Immich runs as a small cluster of containers: the main server, a machine-learning worker, Redis for caching, and a Postgres database with pgvector for similarity search. Its library and database are stored on a separate drive for capacity reasons. 
- Jellyfin similarly mounts its media from a larger capacity drive.
- Open WebUI provides a browser-based chat interface backed by Ollama for local LLM inference. It can optionally connect to additional endpoints (e.g. a DGX Spark) — the Makefile resolves mDNS hostnames to IPs at startup so Docker containers can reach them. It also supports [Ollama Cloud](https://ollama.com) as an OpenAI-compatible connection — set `OLLAMA_CLOUD_API_KEY` in `.env` to enable it.
- Perforce Helix Core runs as a single-binary server (`p4d`), storing all depot data in a bind-mounted directory on `/mnt/vault-3/Perforce`. It uses its own binary protocol over TCP on port 1666, exposed through Pangolin via raw TCP passthrough.
- Websidian is a custom-built, read-only web viewer for an Obsidian vault. It mounts the vault as a read-only volume and serves a React SPA with full markdown rendering, wikilink resolution, backlinks, full-text search, and a knowledge graph. Built with Bun, Hono, and React.
- Zulip is deployed from the [upstream docker-zulip packaging](https://github.com/zulip/docker-zulip) (pinned via `ZULIP_IMAGE_TAG`). It runs the app server with `DISABLE_HTTPS=True` behind Traefik/Pangolin and ships with its own Postgres/RabbitMQ/Redis/Memcached sidecars (prefixed `zulip-*` to match the Cumulus convention). The five auto-generated infrastructure secrets (postgres, memcached, rabbitmq, redis, Django secret key) live as Compose-mounted files in `zulip/secrets/` — `make setup phd-server` generates them on first run and you never touch them again. The setup is idempotent and self-healing: re-running it preserves existing host files, and if any are missing it restores them from the `cumulus_zulip-data` Docker volume's `zulip-secrets.conf` (so a wiped `zulip/secrets/` directory doesn't strand the persisted database with credentials it can no longer reproduce). Random generation is only the fallback when neither host file nor volume value exists. The SMTP password lives in `.env` as `ZULIP_SMTP_PASSWORD` like every other Cumulus credential, and is passed in as a `SECRETS_email_password` env var that the upstream entrypoint reads into `zulip-secrets.conf`. Until Resend issues the key, leave it empty — Zulip starts fine and just warns that SMTP is unconfigured; recreate the Zulip container after filling it in.
- Kitsu (CGWire) is a production tracker for CG/animation/VFX pipelines. Unlike most services it is **built locally** rather than pulled — two small Dockerfiles under `kitsu/` build the Zou API from PyPI and the Kitsu frontend from CGWire's prebuilt `-build` git tag (recipe adapted from the [Mathieu Bouzard fork](https://gitlab.com/mathbou/docker-cgwire)). It runs seven containers — the Nginx frontend, three Zou roles (API, event stream, async jobs), plus Postgres, Redis, and a Meilisearch index — on a dedicated `kitsu-internal` network, isolated from the rest of the stack and reachable only through its `127.0.0.1` frontend port. Persistent data (preview media + Postgres) is bind-mounted under `/mnt/vault-3/Kitsu`. Image versions are pinned in `.env`, and because the images are built locally, upgrades are build-driven (`make kitsu-rebuild && make kitsu-upgrade`), not `make pull`. First run is `make kitsu-build && make kitsu-up && make kitsu-init`.

Each host is managed independently via the Makefile (e.g. `make up droplet`, `make logs phd-server`).

## Quick Start

The manual config to get set up is pretty minimal; Pangolin, Immich, and Jellyfin all have great UIs for handling the majority of the relevant config.

```sh
# 1. Set your environment variables
cp .env.example .env
# Edit .env — set BASE_DOMAIN, ACME_EMAIL, and the secrets for your host

# 2. Run setup (creates directories and generates config from templates)
make setup droplet        # or: make setup phd-server

# 3. Start services
make up droplet           # or: make up phd-server
```

### What gets configured where

**`.env`** is the single source of truth for all settings — domains, secrets, paths, and credentials. Edit this first; everything else is derived from it.

**`make setup <host>`** uses `envsubst` to generate the actual config files from templates:

| Template | Generated file | Key variables |
|----------|---------------|---------------|
| `pangolin/config/config.yml.template` | `config.yml` | `BASE_DOMAIN` |
| `pangolin/config/traefik/traefik_config.yml.template` | `traefik_config.yml` | `ACME_EMAIL` |
| `pangolin/config/traefik/dynamic_config.yml.template` | `dynamic_config.yml` | `BASE_DOMAIN` |

The generated files are gitignored, so you must run `make setup` on each host after cloning. Do **not** copy the `.template` files directly — the `${VAR}` placeholders won't be substituted at runtime.

## Commands

All commands take a host argument (`droplet` or `phd-server`):

```
make up <host>              Start services
make down <host>            Stop services
make pull <host>            Pull latest images
make rebuild <host>         Clean rebuild all services
make logs <host>            View all logs
make logs <host> s=<svc>    View logs for one service
make ps <host>              Show running containers
make setup <host>           Create required directories
make clean <host>           Stop services and remove Docker resources
make sync                   Force-pull latest from git
```

### Perforce commands (phd-server only)

```
make p4 cmd='<command>'     Run any p4 command in the container
make p4-info                Show server info
make p4-users               List users
make p4-depots              List depots
make p4-logs                Tail the Perforce server log
make p4-shell               Open a shell in the Perforce container
```

### Zulip commands (phd-server only)

```
make zulip cmd='<args>'     Run a manage.py command in the Zulip container
make zulip-create-org       Generate a one-time realm creation link
make zulip-register-push    Register with the Mobile Push Notification Service (one-time, interactive)
make zulip-shell            Open a shell in the Zulip container
make zulip-backup           Postgres dump + tar of /data into ./backups/zulip/
make zulip-gen-secret       Print a strong random secret (for manual rotation)
```

Upgrade discipline: read the release notes, bump `ZULIP_IMAGE_TAG` in `.env`, then `make zulip-backup && make pull phd-server && make up phd-server`. Upgrade **one major version at a time**; skipping versions breaks migrations. Postgres major upgrades are a separate, deliberate operation (see [upstream docs](https://zulip.readthedocs.io/projects/docker/)).

### Kitsu commands (phd-server only)

Kitsu's images are **built locally**, so `make pull` does not update it. First run:

```
make kitsu-build            Build the cumulus-zou + cumulus-kitsu images (pinned versions)
make kitsu-up               Start Kitsu's services
make kitsu-init             First run only: seed schema, admin (from .env), search index
```

Day to day:

```
make kitsu-down             Stop just Kitsu's services
make kitsu-restart          Restart just Kitsu's services
make kitsu-logs             Tail Kitsu's logs
make kitsu-ps               Show Kitsu's containers
make kitsu-backup           Postgres dump + tar of previews into ./backups/kitsu/
make kitsu-create-admin     Create/reset the admin user from .env
make kitsu-reindex          Rebuild the Meilisearch index
make kitsu-shell            Open a shell in the zou-app container
make kitsu cmd='<args>'     Run an arbitrary zou CLI command
```

Upgrade discipline: read the [Kitsu](https://github.com/cgwire/kitsu/releases) / [Zou](https://github.com/cgwire/zou/releases) release notes, bump `KITSU_VERSION` / `ZOU_VERSION` in `.env` (one release at a time), then `make kitsu-backup && make kitsu-rebuild && make kitsu-upgrade`. Postgres major upgrades are a separate, deliberate operation. The scoped `kitsu-*` targets keep all of this off the rest of the phd-server stack.
