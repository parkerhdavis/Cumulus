# Cumulus

Self-hosted services running on personal infrastructure, managed with Docker Compose. Nothing too fancy or novel; I just wanted to share how I coordinate some of my favorite self-hosting tools.

## Services

The stack is split across two hosts, each with its own compose file:

**Droplet** (DigitalOcean VPS) is the public-facing edge:

| Service | Description |
|---------|-------------|
| **Pangolin** | Reverse proxy & tunnel management |
| **Gerbil** | WireGuard tunnel agent for Pangolin |
| **Traefik** | Edge router handling HTTPS termination and routing |

**phd-server** (home server) is where the actual applications run:

| Service | Description |
|---------|-------------|
| **Newt** | Tunnel agent that connects back to Pangolin |
| **Jellyfin** | Media server for movies, TV, music |
| **Immich** | Self-hosted photo & video management |
| **Immich ML** | Machine learning sidecar for face/object recognition |
| **Immich Redis** | Caching layer for Immich (Valkey) |
| **Immich Database** | PostgreSQL with vector extensions for Immich search |

### How it all fits together

On the Droplet: Pangolin, Gerbil, and Traefik run on a small cloud VPS and act as the public entry point with whatever auth/routing controls I need. Traefik terminates HTTPS and Gerbil manages WireGuard tunnels. On the home server, Newt establishes an outbound tunnel back to the Pangolin endpoint (`pangolin.parkerhdavis.com`), so services like Jellyfin and Immich are reachable from the internet without exposing the home network or forwarding ports on the router.

On the Server: 

- Immich runs as a small cluster of containers: the main server, a machine-learning worker, Redis for caching, and a Postgres database with pgvector for similarity search. Its library and database are stored on a separate drive for capacity reasons. 
- Jellyfin similarly mounts its media from a larger capacity drive. Each host is managed independently via the Makefile (e.g. `make up droplet`, `make logs phd-server`).

## Quick Start

The manual config to get set up is pretty minimal; Pangolin, Immich, and Jellyfin all have great UIs for handling the majority of the relevant config.

```sh
# 1. Create config directories for your host
make setup droplet        # or: make setup phd-server

# 2. Set secrets
cp .env.example .env
# Edit .env — droplet needs SERVER_SECRET, phd-server needs NEWT_ID/NEWT_SECRET + Immich DB creds

# 3. Review Pangolin config (droplet only)
#    pangolin/config/config.yml

# 4. Start services
make up droplet           # or: make up phd-server
```

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
