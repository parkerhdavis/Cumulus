.PHONY: help up down rebuild logs ps clean sync setup

help:
	@echo "Cumulus - Self-Hosted Services"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Running:"
	@echo "  up                 # Start all services"
	@echo "  down               # Stop all services"
	@echo "  rebuild            # Clean stop + rebuild images + start services"
	@echo ""
	@echo "Logging:"
	@echo "  logs               # View all service logs (Ctrl+C to exit)"
	@echo "  logs s=<service>   # View logs for a specific service (e.g., make logs s=pangolin)"
	@echo "  ps                 # Show running containers"
	@echo ""
	@echo "Setup:"
	@echo "  setup              # Create required directories and prepare config"
	@echo ""
	@echo "Cleanup:"
	@echo "  clean              # Stop services and remove ephemeral Docker resources"
	@echo ""
	@echo "Repository:"
	@echo "  sync               # Pull latest changes from git (force, discards local changes)"
	@echo ""


# ==================================================================
# SERVICE COMMANDS
# ==================================================================

# -------------
# Running
# -------------

up:
	@echo "Starting Cumulus services..."
	docker compose up -d
	@echo "Services started"

down:
	@echo "Stopping Cumulus services..."
	docker compose down
	@echo "Services stopped"

rebuild: clean
	@echo "Rebuilding Cumulus services..."
	@if ! docker ps > /dev/null 2>&1; then \
		echo "Error: Docker daemon not running"; \
		exit 1; \
	fi
	docker compose up -d --build --force-recreate
	@echo "Services rebuilt and started"

# -------------
# Logging
# -------------

logs:
ifdef s
	@echo "Showing logs for $(s) (Ctrl+C to exit)..."
	docker compose logs -f $(s)
else
	@echo "Showing all logs (Ctrl+C to exit)..."
	docker compose logs -f
endif

ps:
	@echo "Running containers:"
	docker compose ps

# -------------
# Setup
# -------------

setup:
	@echo "Creating required directories..."
	mkdir -p pangolin/config/traefik/logs
	mkdir -p pangolin/config/letsencrypt
	@echo "Directory structure ready"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Copy .env.example to .env and set SERVER_SECRET"
	@echo "  2. Review pangolin/config/config.yml"
	@echo "  3. Run 'make up' to start services"

# -------------
# Cleanup
# -------------

clean:
	@echo "Cleaning up Cumulus Docker resources..."
	docker compose down --remove-orphans
	@echo "Cleanup complete"

# -------------
# Repository
# -------------

sync:
	@echo "Syncing to latest from git (force pull)..."
	git fetch origin
	git reset --hard origin/main
	git clean -fd
	@echo "Sync complete"


.DEFAULT_GOAL := help
