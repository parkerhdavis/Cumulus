# Cumulus

Self-hosted services running on personal infrastructure, managed with Docker Compose. Nothing too fancy or novel; I just wanted to share how I coordinate some of my favorite self-hosting services.

## Services

The stack is split across four hosts, each with its own compose file:

**Droplet** (DigitalOcean VPS) is the public-facing edge:

| Service | Description |
|---------|-------------|
| **[Pangolin](https://github.com/fosrl/pangolin)** | Reverse proxy & tunnel management |
| **[Gerbil](https://github.com/fosrl/gerbil)** | WireGuard tunnel agent for Pangolin |
| **[Traefik](https://github.com/traefik/traefik)** | Edge router handling HTTPS termination and routing |
| **[CrowdSec](https://github.com/crowdsecurity/crowdsec)** | Edge IPS/WAF — bans malicious IPs and inspects requests via a Traefik bouncer plugin |

**phd-beelink** (home server) is where the actual applications run:

| Service | Description |
|---------|-------------|
| **[Newt](https://github.com/fosrl/newt)** | Tunnel agent that connects back to Pangolin |
| **[Jellyfin](https://github.com/jellyfin/jellyfin)** | Media server for movies, TV, music |
| **[Immich](https://github.com/immich-app/immich)** | Self-hosted photo & video management |
| **Immich ML** | Machine learning sidecar for face/object recognition |
| **Immich Redis** | Caching layer for Immich (Valkey) |
| **Immich Database** | PostgreSQL with vector extensions for Immich search |
| **[Open WebUI](https://github.com/open-webui/open-webui)** | LLM chat interface with model management |
| **[x11vnc](https://github.com/LibVNC/x11vnc)** | Containerized VNC server sharing the host's real display (loopback :5900) |
| **[Gokapi](https://github.com/Forceu/Gokapi)** | Lightweight file-drop / sharing service (Firefox Send alternative) |

**phd-tower** (tower PC) is a minimal site host:

| Service | Description |
|---------|-------------|
| **Newt** | Pangolin site agent (`fosrl/pangolin-cli`) connecting the tower to Pangolin |
| **[x11vnc](https://github.com/LibVNC/x11vnc)** | Containerized VNC server sharing the host's real display (loopback :5900) |

**phd-razer** (workstation) is another minimal site host:

| Service | Description |
|---------|-------------|
| **Newt** | Tunnel agent connecting the workstation to Pangolin |
| **[x11vnc](https://github.com/LibVNC/x11vnc)** | Containerized VNC server sharing the host's real display (loopback :5900) |

### How it all fits together

On the Droplet: Pangolin, Gerbil, and Traefik run on a small cloud VPS and act as the public entry point with whatever auth/routing controls I need. Traefik terminates HTTPS and Gerbil manages WireGuard tunnels. CrowdSec sits alongside Traefik as an edge IPS/WAF: a bouncer plugin is attached to Traefik's `websecure` entry point, so every HTTPS request is checked against CrowdSec's decisions (community blocklist + locally-detected bad actors) and inspected by its AppSec engine before it reaches any service. It has no published ports — Traefik reaches it over the internal network — and its WAF is configured to fail open, so a CrowdSec outage never takes the edge down. On the home server, Newt establishes an outbound tunnel back to the Pangolin endpoint, so services like Jellyfin and Immich are reachable from the internet without exposing the home network or forwarding ports on the router. The tower and the workstation connect the same way — their site agents dial out to Pangolin, making each machine a Pangolin site, and each site host runs a containerized x11vnc server that shares the machine's real display (below) through that tunnel.

On the Server: 

- Immich runs as a small cluster of containers: the main server, a machine-learning worker, Redis for caching, and a Postgres database with pgvector for similarity search. Its library and database are stored on a separate drive for capacity reasons. 
- Jellyfin similarly mounts its media from a larger capacity drive.
- Open WebUI provides a browser-based chat interface, backed by [Ollama Cloud](https://ollama.com) as an OpenAI-compatible connection — the connection and key are set from its admin UI.
- Gokapi is a lightweight file-drop service (a self-hosted Firefox Send alternative) for sharing files via expiring links, reachable at `drop.${BASE_DOMAIN}`. Like Jellyfin and Immich it's configured through a first-run web setup wizard (`https://drop.${BASE_DOMAIN}/setup`) where you set the admin account and the public URL. Uploaded files are bind-mounted from a capacity drive via `GOKAPI_DATA_PATH` (they can accumulate), while the small config and SQLite database live in the `gokapi-config` named volume. It listens on `127.0.0.1:53842` and is exposed through Pangolin as a standard HTTP resource pointing at `localhost:53842`.

Each host is managed independently via the Makefile (e.g. `make up droplet`, `make logs phd-beelink`).

### Remote desktop

Each site host runs a containerized `x11vnc` (built from `x11vnc/Dockerfile`) that shares the machine's **real** X11 display — the host's X socket and LightDM's Xauthority are bind-mounted read-only, so a Pangolin **VNC public resource** (backend `localhost:5900`) lands you in the actual logged-in session, on the actual screen, not a containerized sandbox. The VNC password is the host's `DESKTOP_PASSWORD` from `.env` (only its first 8 characters matter — the VNC auth format truncates). A host with no running X session — a headless server, or before someone logs in — has nothing to share, and the resource stays down until a session exists.

## Quick Start

The manual config to get set up is pretty minimal; Pangolin, Immich, and Jellyfin all have great UIs for handling the majority of the relevant config.

```sh
# 1. Set your environment variables
cp .env.example .env
# Edit .env — set BASE_DOMAIN, ACME_EMAIL, and the secrets for your host

# 2. Run setup (creates directories and generates config from templates)
make setup droplet        # or: make setup phd-beelink

# 3. Start services
make up droplet           # or: make up phd-beelink
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

All commands take a host argument (`droplet`, `phd-beelink`, `phd-tower`, or `phd-razer`):

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
