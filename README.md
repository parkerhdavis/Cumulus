# Cumulus

Self-hosted services running on personal infrastructure, managed with Docker Compose.

## Services

| Service | Description |
|---------|-------------|
| **Pangolin** | Reverse proxy & tunnel management dashboard |
| **Gerbil** | WireGuard tunnel agent for Pangolin |
| **Traefik** | Edge router handling HTTPS and routing |

Dashboard: https://pangolin.parkerhdavis.com

## Quick Start

```sh
# 1. Create config directories
make setup

# 2. Set secrets
cp .env.example .env
# Edit .env and set SERVER_SECRET (openssl rand -hex 32)

# 3. Review Pangolin config
#    pangolin/config/config.yml

# 4. Start everything
make up
```

## Commands

```
make up                 Start all services
make down               Stop all services
make rebuild            Clean rebuild all services
make logs               View all logs
make logs s=pangolin    View logs for one service
make ps                 Show running containers
make setup              Create required directories
make clean              Stop services and remove Docker resources
make sync               Force-pull latest from git
```

## Project Structure

```
Cumulus/
├── docker-compose.yml          # All service definitions
├── Makefile                    # Common commands
├── .env                        # Secrets (not committed)
└── pangolin/config/
    ├── config.yml              # Pangolin app config
    └── traefik/
        ├── traefik_config.yml  # Traefik static config
        └── dynamic_config.yml  # Traefik dynamic routing
```
