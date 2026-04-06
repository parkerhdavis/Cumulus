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
| **[Websidian](websidian/)** | Custom web-based viewer for Obsidian vaults |

### How it all fits together

On the Droplet: Pangolin, Gerbil, and Traefik run on a small cloud VPS and act as the public entry point with whatever auth/routing controls I need. Traefik terminates HTTPS and Gerbil manages WireGuard tunnels. On the home server, Newt establishes an outbound tunnel back to the Pangolin endpoint, so services like Jellyfin and Immich are reachable from the internet without exposing the home network or forwarding ports on the router.

On the Server: 

- Immich runs as a small cluster of containers: the main server, a machine-learning worker, Redis for caching, and a Postgres database with pgvector for similarity search. Its library and database are stored on a separate drive for capacity reasons. 
- Jellyfin similarly mounts its media from a larger capacity drive.
- Open WebUI provides a browser-based chat interface backed by Ollama for local LLM inference. It can optionally connect to additional endpoints (e.g. a DGX Spark) — the Makefile resolves mDNS hostnames to IPs at startup so Docker containers can reach them.
- Websidian is a custom-built, read-only web viewer for an Obsidian vault. It mounts the vault as a read-only volume and serves a React SPA with full markdown rendering, wikilink resolution, backlinks, full-text search, and a knowledge graph. Built with Bun, Hono, and React.

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
