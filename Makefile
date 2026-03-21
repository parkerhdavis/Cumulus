.PHONY: help up down pull rebuild logs ps clean sync setup droplet phd-server

# ==================================================================
# HOST DETECTION
# ==================================================================

ifneq (,$(filter droplet,$(MAKECMDGOALS)))
  COMPOSE_FILE := docker-compose.droplet.yml
  HOST_NAME := droplet
endif

ifneq (,$(filter phd-server,$(MAKECMDGOALS)))
  COMPOSE_FILE := docker-compose.phd-server.yml
  HOST_NAME := phd-server
endif

DOCKER_COMPOSE := docker compose -f $(COMPOSE_FILE)

# No-op targets so make doesn't complain about "No rule to make target"
droplet phd-server:
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
	@echo "  phd-server           # Home server (newt)"
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
	@echo "  make logs phd-server # View Newt logs on home server"
	@echo ""

# ==================================================================
# SERVICE COMMANDS (require a host)
# ==================================================================

define require_host
	$(if $(HOST_NAME),,$(error Specify a host: make $(1) droplet OR make $(1) phd-server))
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
ifeq ($(HOST_NAME),droplet)
	@echo "Creating required directories for droplet..."
	mkdir -p pangolin/config/traefik/logs
	mkdir -p pangolin/config/letsencrypt
	@echo "Directory structure ready"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Copy .env.example to .env and set SERVER_SECRET"
	@echo "  2. Review pangolin/config/config.yml"
	@echo "  3. Run 'make up droplet' to start services"
else ifeq ($(HOST_NAME),phd-server)
	@echo "No directory setup needed for phd-server"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Copy .env.example to .env and set NEWT_ID and NEWT_SECRET"
	@echo "  2. Run 'make up phd-server' to start services"
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
