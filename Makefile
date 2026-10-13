.PHONY: help up down pull rebuild logs ps clean sync setup droplet phd-beelink phd-tower \
       phd-razer

# ==================================================================
# HOST DETECTION
# ==================================================================

ifneq (,$(filter droplet,$(MAKECMDGOALS)))
  COMPOSE_FILE := docker-compose.droplet.yml
  HOST_NAME := droplet
endif

ifneq (,$(filter phd-beelink,$(MAKECMDGOALS)))
  COMPOSE_FILE := docker-compose.phd-beelink.yml
  HOST_NAME := phd-beelink
endif

ifneq (,$(filter phd-tower,$(MAKECMDGOALS)))
  COMPOSE_FILE := docker-compose.phd-tower.yml
  HOST_NAME := phd-tower
endif

ifneq (,$(filter phd-razer,$(MAKECMDGOALS)))
  COMPOSE_FILE := docker-compose.phd-razer.yml
  HOST_NAME := phd-razer
endif

DOCKER_COMPOSE := docker compose -f $(COMPOSE_FILE)

# No-op targets so make doesn't complain about "No rule to make target"
droplet phd-beelink phd-tower phd-razer:
	@:

# ==================================================================
# HELP
# ==================================================================

help:
	@echo "Cumulus - Self-Hosted Services"
	@echo ""
	@echo "Usage: make <command> <host>"
	@echo ""
	@echo "Hosts:"
	@echo "  droplet              # DigitalOcean droplet (pangolin, gerbil, traefik)"
	@echo "  phd-beelink          # Home server (site agent, jellyfin, immich, ...)"
	@echo "  phd-tower          # Tower PC (pangolin site agent, forgejo)"
	@echo "  phd-razer            # Razer workstation (site agent)"
	@echo ""
	@echo "Running:"
	@echo "  up <host>            # Start services"
	@echo "  down <host>          # Stop services"
	@echo "  pull <host>          # Pull latest images for services"
	@echo "  rebuild <host>       # Clean stop + rebuild images + start services"
	@echo ""
	@echo "Logging:"
	@echo "  logs <host>          # View all service logs (Ctrl+C to exit)"
	@echo "  logs <host> s=<svc>  # View logs for a specific service"
	@echo "  ps <host>            # Show running containers"
	@echo ""
	@echo "Setup:"
	@echo "  setup <host>         # Create required directories and prepare config"
	@echo ""
	@echo "Cleanup:"
	@echo "  clean <host>         # Stop services and remove ephemeral Docker resources"
	@echo ""
	@echo "Repository:"
	@echo "  sync                 # Pull latest changes from git (force, discards local changes)"
	@echo ""
	@echo "Examples:"
	@echo "  make up droplet      # Start Pangolin services on droplet"
	@echo "  make logs phd-beelink # View site agent logs on home server"
	@echo ""

# ==================================================================
# SERVICE COMMANDS (require a host)
# ==================================================================

define require_host
	$(if $(HOST_NAME),,$(error Specify a host: make $(1) droplet, phd-beelink, phd-tower, or phd-razer))
endef

# -------------
# Running
# -------------

up:
	$(call require_host,up)
	@echo "Starting $(HOST_NAME) services..."
	$(DOCKER_COMPOSE) up -d
	@echo "Services started on $(HOST_NAME)"

down:
	$(call require_host,down)
	@echo "Stopping $(HOST_NAME) services..."
	$(DOCKER_COMPOSE) down
	@echo "Services stopped on $(HOST_NAME)"

pull:
	$(call require_host,pull)
	@echo "Pulling latest images for $(HOST_NAME)..."
	$(DOCKER_COMPOSE) pull
	@echo "Images pulled for $(HOST_NAME)"

rebuild: clean
	$(call require_host,rebuild)
	@echo "Rebuilding $(HOST_NAME) services..."
	@if ! docker ps > /dev/null 2>&1; then \
		echo "Error: Docker daemon not running"; \
		exit 1; \
	fi
	$(DOCKER_COMPOSE) up -d --build --force-recreate
	@echo "Services rebuilt and started on $(HOST_NAME)"

# -------------
# Logging
# -------------

logs:
	$(call require_host,logs)
ifdef s
	@echo "Showing $(HOST_NAME) logs for $(s) (Ctrl+C to exit)..."
	$(DOCKER_COMPOSE) logs -f $(s)
else
	@echo "Showing $(HOST_NAME) logs (Ctrl+C to exit)..."
	$(DOCKER_COMPOSE) logs -f
endif

ps:
	$(call require_host,ps)
	@echo "Running containers on $(HOST_NAME):"
	$(DOCKER_COMPOSE) ps

# -------------
# Setup
# -------------

setup:
	$(call require_host,setup)
	@if [ ! -f .env ]; then \
		echo "Error: .env not found. Run 'cp .env.example .env' and fill in your values first."; \
		exit 1; \
	fi
ifeq ($(HOST_NAME),droplet)
	@echo "Creating required directories for droplet..."
	mkdir -p pangolin/config/traefik/logs
	mkdir -p pangolin/config/letsencrypt
	mkdir -p pangolin/config/crowdsec/acquis.d
	@echo "Generating config files from templates..."
	@set -a && . ./.env && set +a && \
		envsubst < pangolin/config/config.yml.template > pangolin/config/config.yml && \
		envsubst < pangolin/config/traefik/traefik_config.yml.template > pangolin/config/traefik/traefik_config.yml && \
		envsubst < pangolin/config/traefik/dynamic_config.yml.template > pangolin/config/traefik/dynamic_config.yml
	@echo "Config files generated"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Review generated config in pangolin/config/"
	@echo "  2. Run 'make up droplet' to start services"
else ifeq ($(HOST_NAME),phd-beelink)
	@echo "Building the Tier-3 proxy-encoder image (ffmpeg + bash entrypoint)..."
	@docker build -q -t cumulus/proxy-encoder:latest -f ofelia/encoder.Dockerfile ofelia/ >/dev/null && \
		echo "  built cumulus/proxy-encoder:latest"
	@echo "Rendering Ofelia proxy-job config and creating its state dir..."
	@set -a && . ./.env && set +a && \
		mkdir -p "$${PROXY_STATE_PATH:-/mnt/vault-2/Archival/proxy-logs}" && \
		export MEDIA_PIPELINE_PATH="$$PWD/media-pipeline" && \
		envsubst < ofelia/config.ini.template > ofelia/config.ini && \
		echo "  rendered ofelia/config.ini"
	@echo ""
	@echo "Next step: Run 'make up phd-beelink' to start services"
	@echo ""
else ifeq ($(HOST_NAME),phd-tower)
	@set -a && . ./.env && set +a && \
		if [ -z "$$FORGEJO_DATA_PATH" ] || [ "$$FORGEJO_DATA_PATH" = "changeme" ]; then \
			echo "Error: FORGEJO_DATA_PATH is not set in .env"; \
			exit 1; \
		fi && \
		if [ -z "$$FORGEJO_DB_PASSWORD" ] || [ "$$FORGEJO_DB_PASSWORD" = "changeme" ] || \
		   [ -z "$$FORGEJO_SECRET_KEY" ] || [ "$$FORGEJO_SECRET_KEY" = "changeme" ] || \
		   [ -z "$$FORGEJO_INTERNAL_TOKEN" ] || [ "$$FORGEJO_INTERNAL_TOKEN" = "changeme" ] || \
		   [ -z "$$FORGEJO_LFS_JWT_SECRET" ] || [ "$$FORGEJO_LFS_JWT_SECRET" = "changeme" ]; then \
			echo "Error: FORGEJO_DB_PASSWORD, FORGEJO_SECRET_KEY, FORGEJO_INTERNAL_TOKEN and FORGEJO_LFS_JWT_SECRET must all be generated values in .env (see .env.example)"; \
			exit 1; \
		fi && \
		mkdir -p "$$FORGEJO_DATA_PATH" && \
		echo "Forgejo data directory ready at $$FORGEJO_DATA_PATH"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Make sure the Forgejo data directory is owned by uid/gid 1000"
	@echo "     (chown -R 1000:1000 <path>; the forgejo container refuses to start otherwise)"
	@echo "  2. Run 'make up phd-tower' to start services"
	@echo ""
	@echo "Building the forge-backup image (restic + pg client + crond)..."
	@docker build -q -t cumulus/forge-backup:latest -f restic/Dockerfile restic/ >/dev/null && \
		echo "  built cumulus/forge-backup:latest"
	@echo "Backups are stubbed DORMANT: the service sits behind the 'backups' compose"
	@echo "profile and stays out of 'make up'. To plug in later: fill BACKUP_* in"
	@echo ".env, restic init, then --profile backups up -d backup (Backup Design doc)."
	@echo ""
else ifeq ($(HOST_NAME),phd-razer)
	@echo "Nothing to render for phd-razer — config comes entirely from .env"
	@echo ""
	@echo "Next step: Run 'make up phd-razer' to start services"
	@echo ""
endif

# -------------
# Cleanup
# -------------

clean:
	$(call require_host,clean)
	@echo "Cleaning up $(HOST_NAME) Docker resources..."
	$(DOCKER_COMPOSE) down --remove-orphans
	@echo "Cleanup complete on $(HOST_NAME)"

# ==================================================================
# GLOBAL COMMANDS (no host needed)
# ==================================================================

sync:
	@echo "Syncing to latest from git (force pull)..."
	git fetch origin
	git reset --hard origin/main
	git clean -fd
	@echo "Sync complete"


.DEFAULT_GOAL := help
