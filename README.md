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
| **[CrowdSec](https://github.com/crowdsecurity/crowdsec)** | Edge IPS/WAF — bans malicious IPs and inspects requests via a Traefik bouncer plugin |

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
| **[Gokapi](https://github.com/Forceu/Gokapi)** | Lightweight file-drop / sharing service (Firefox Send alternative) |

### How it all fits together

On the Droplet: Pangolin, Gerbil, and Traefik run on a small cloud VPS and act as the public entry point with whatever auth/routing controls I need. Traefik terminates HTTPS and Gerbil manages WireGuard tunnels. CrowdSec sits alongside Traefik as an edge IPS/WAF: a bouncer plugin is attached to Traefik's `websecure` entry point, so every HTTPS request is checked against CrowdSec's decisions (community blocklist + locally-detected bad actors) and inspected by its AppSec engine before it reaches any service. It has no published ports — Traefik reaches it over the internal network — and its WAF is configured to fail open, so a CrowdSec outage never takes the edge down. On the home server, Newt establishes an outbound tunnel back to the Pangolin endpoint, so services like Jellyfin and Immich are reachable from the internet without exposing the home network or forwarding ports on the router.

On the Server: 

- Immich runs as a small cluster of containers: the main server, a machine-learning worker, Redis for caching, and a Postgres database with pgvector for similarity search. Its library and database are stored on a separate drive for capacity reasons. 
- Jellyfin similarly mounts its media from a larger capacity drive.
- Open WebUI provides a browser-based chat interface backed by Ollama for local LLM inference. It can optionally connect to additional endpoints (e.g. a DGX Spark) — the Makefile resolves mDNS hostnames to IPs at startup so Docker containers can reach them. It also supports [Ollama Cloud](https://ollama.com) as an OpenAI-compatible connection — set `OLLAMA_CLOUD_API_KEY` in `.env` to enable it.
- Perforce Helix Core runs as a single-binary server (`p4d`), storing all depot data in a bind-mounted directory on `/mnt/vault-3/Perforce`. It uses its own binary protocol over TCP on port 1666, exposed through Pangolin via raw TCP passthrough.
- Websidian is a custom-built, read-only web viewer for an Obsidian vault. It mounts the vault as a read-only volume and serves a React SPA with full markdown rendering, wikilink resolution, backlinks, full-text search, and a knowledge graph. Built with Bun, Hono, and React.
- Gokapi is a lightweight file-drop service (a self-hosted Firefox Send alternative) for sharing files via expiring links, reachable at `drop.${BASE_DOMAIN}`. Like Jellyfin and Immich it's configured through a first-run web setup wizard (`https://drop.${BASE_DOMAIN}/setup`) where you set the admin account and the public URL. Uploaded files are bind-mounted from a capacity drive via `GOKAPI_DATA_PATH` (they can accumulate), while the small config and SQLite database live in the `gokapi-config` named volume. It listens on `127.0.0.1:53842` and is exposed through Pangolin as a standard HTTP resource pointing at `localhost:53842`.

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
| `pangolin/config/traefik/dynamic_config.yml.template` | `dynamic_config.yml` | `BASE_DOMAIN`, `CROWDSEC_LAPI_KEY` |

The generated files are gitignored, so you must run `make setup` on each host after cloning. Do **not** copy the `.template` files directly — the `${VAR}` placeholders won't be substituted at runtime.

**Applying config changes:** `make setup <host>` re-renders the templates, but `make up <host>` won't restart a container whose service definition is unchanged — Docker Compose doesn't notice edits to the *contents* of bind-mounted config files. Traefik in particular reads its static config (`traefik_config.yml` — plugins, entry points, access logs) only at startup; only `dynamic_config.yml` is hot-reloaded by the file provider. So after changing any rendered Traefik config, force-recreate it:

```sh
docker compose -f docker-compose.droplet.yml up -d --force-recreate traefik
# or, heavier (recreates the whole edge): make rebuild droplet
```

CrowdSec needs no manual bootstrap: the bouncer key is the same `CROWDSEC_LAPI_KEY` on both sides (registered on the container via `BOUNCER_KEY_traefik`, consumed by the Traefik plugin via `crowdsecLapiKey`). Its acquisition configs (`pangolin/config/crowdsec/acquis.d/*.yaml`) are committed static files — not templated — and its state (hub collections, decisions DB) lives in the `crowdsec-config` / `crowdsec-data` named volumes. On first `make up droplet`, Traefik downloads the bouncer plugin and CrowdSec pulls its collections, so give it a minute before testing. To confirm a real ban targets a real client IP, `make logs droplet s=traefik` should show your public IP as `ClientHost` in the JSON access log.

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
