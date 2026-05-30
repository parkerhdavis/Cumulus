.PHONY: help up down pull rebuild logs ps clean sync setup droplet phd-server \
       p4 p4-info p4-users p4-depots p4-logs p4-shell \
       zulip zulip-create-org zulip-register-push zulip-shell zulip-backup zulip-gen-secret

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

# Resolve Spark mDNS hostname → IP and append to OPEN_WEBUI_OLLAMA_URLS
# (Docker containers can't resolve .local hostnames natively)
RESOLVE_SPARK = SPARK_HOST=$$(grep -s '^SPARK_HOSTNAME=' .env | cut -d= -f2-); \
	if [ -n "$$SPARK_HOST" ]; then \
		SPARK_IP=$$(getent hosts "$$SPARK_HOST" 2>/dev/null | awk '{print $$1}'); \
		if [ -n "$$SPARK_IP" ]; then \
			echo "Resolved $$SPARK_HOST → $$SPARK_IP"; \
			BASE_URLS=$$(grep -s '^OPEN_WEBUI_OLLAMA_URLS=' .env | cut -d= -f2-); \
			export OPEN_WEBUI_OLLAMA_URLS="$${BASE_URLS:-http://ollama:11434};http://$$SPARK_IP:11434"; \
		else \
			echo "Warning: Could not resolve $$SPARK_HOST — Spark models will be unavailable"; \
		fi; \
	fi

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
	@echo "Perforce (phd-server):"
	@echo "  p4 <cmd>             # Run any p4 command in the container (e.g. make p4 cmd='verify -q //...')"
	@echo "  p4-info              # Show server info"
	@echo "  p4-users             # List users"
	@echo "  p4-depots            # List depots"
	@echo "  p4-logs              # Tail the Perforce server log"
	@echo "  p4-shell             # Open a shell in the Perforce container"
	@echo ""
	@echo "Zulip (phd-server):"
	@echo "  zulip cmd='<args>'   # Run a manage.py command in the Zulip container"
	@echo "  zulip-create-org     # Generate a one-time realm creation link"
	@echo "  zulip-register-push  # Register this server with the Mobile Push Notification Service (interactive, accepts TOS)"
	@echo "  zulip-shell          # Open a shell in the Zulip container"
	@echo "  zulip-backup         # Postgres dump + tar of /data into ./backups/zulip/"
	@echo "  zulip-gen-secret     # Print one strong random secret (for manual rotation)"
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
ifeq ($(HOST_NAME),phd-server)
	@$(RESOLVE_SPARK); $(DOCKER_COMPOSE) up -d
else
	$(DOCKER_COMPOSE) up -d
endif
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
ifeq ($(HOST_NAME),phd-server)
	@$(RESOLVE_SPARK); $(DOCKER_COMPOSE) up -d --build --force-recreate
else
	$(DOCKER_COMPOSE) up -d --build --force-recreate
endif
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
else ifeq ($(HOST_NAME),phd-server)
	@echo "Creating Zulip secrets and backup directory..."
	mkdir -p zulip/secrets backups/zulip
	@chmod 755 zulip/secrets
	@# postgres_password and secret_key are only read inside the Zulip and
	@# Postgres containers' root-running entrypoints, so they stay 0600.
	@# memcached/rabbitmq/redis sidecars run their entrypoints as unprivileged
	@# users and read the secret file directly — Compose preserves the host
	@# file's permissions in the container mount, so those three get 0444.
	@for name in postgres_password secret_key; do \
		f="zulip/secrets/$$name"; \
		if [ ! -s "$$f" ]; then \
			openssl rand -hex 32 | tr -d '\n' > "$$f"; \
			echo "  generated $$f"; \
		else \
			echo "  kept     $$f (existing)"; \
		fi; \
		chmod 600 "$$f"; \
	done
	@for name in memcached_password rabbitmq_password redis_password; do \
		f="zulip/secrets/$$name"; \
		if [ ! -s "$$f" ]; then \
			openssl rand -hex 32 | tr -d '\n' > "$$f"; \
			echo "  generated $$f (world-readable for sidecar UID)"; \
		else \
			echo "  kept     $$f (existing, world-readable for sidecar UID)"; \
		fi; \
		chmod 644 "$$f"; \
	done
	@echo ""
	@echo "Next steps:"
	@echo "  1. Run 'make up phd-server' to start services"
	@echo "  2. When Resend issues your API key, set ZULIP_SMTP_PASSWORD in .env"
	@echo "     and recreate the container: docker compose -f docker-compose.phd-server.yml up -d zulip"
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
# PERFORCE COMMANDS (phd-server only, no host arg needed)
# ==================================================================

P4 := docker exec perforce p4 -p 127.0.0.1:1666

p4:
	$(P4) $(cmd)

p4-info:
	$(P4) info

p4-users:
	$(P4) users

p4-depots:
	$(P4) depots

p4-logs:
	docker exec perforce tail -f /data/log

p4-shell:
	docker exec -it perforce bash

# ==================================================================
# ZULIP COMMANDS (phd-server only, no host arg needed)
# ==================================================================

ZULIP_MANAGE := docker exec -u zulip zulip /home/zulip/deployments/current/manage.py
ZULIP_BACKUP_DIR := backups/zulip
ZULIP_STAMP := $(shell date +%Y%m%d-%H%M%S)

zulip:
	$(ZULIP_MANAGE) $(cmd)

zulip-create-org:
	$(ZULIP_MANAGE) generate_realm_creation_link

# Interactive: prints the registration data to be sent, then asks for TOS
# acceptance. Needs -it because $(ZULIP_MANAGE) does not allocate a TTY.
zulip-register-push:
	docker exec -it -u zulip zulip /home/zulip/deployments/current/manage.py register_server

zulip-shell:
	docker exec -it zulip bash

# Logical Postgres dump + tar of /data (uploads + zulip-secrets.conf).
# Losing zulip-secrets.conf makes a DB-only backup unrestorable, hence both.
zulip-backup:
	@mkdir -p $(ZULIP_BACKUP_DIR)
	@echo ">> Dumping Postgres -> $(ZULIP_BACKUP_DIR)/db-$(ZULIP_STAMP).sql.gz"
	docker exec -T zulip_database pg_dump -U zulip zulip | gzip > $(ZULIP_BACKUP_DIR)/db-$(ZULIP_STAMP).sql.gz
	@echo ">> Archiving /data -> $(ZULIP_BACKUP_DIR)/data-$(ZULIP_STAMP).tgz"
	docker exec -T zulip tar -czf - -C /data . > $(ZULIP_BACKUP_DIR)/data-$(ZULIP_STAMP).tgz
	@echo ">> Backup complete: $(ZULIP_STAMP)"

zulip-gen-secret:
	@openssl rand -hex 32

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
