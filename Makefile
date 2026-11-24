# Containers run on a Docker engine reached over SSH (decision D-23). Set MW_DOCKER_HOST= (empty) to use
# the local engine instead (CI does this); use the standard ports and skip the tunnel.
MW_DOCKER_HOST ?= ssh://fd
# For an SSH engine, reuse its [user@]host and optional port for the tunnel.
ENGINE_SSH_ADDRESS := $(patsubst ssh://%,%,$(filter ssh://%,$(MW_DOCKER_HOST)))
ENGINE_SSH_PARTS := $(subst :, ,$(ENGINE_SSH_ADDRESS))
MW_TUNNEL_HOST ?= $(or $(firstword $(ENGINE_SSH_PARTS)),fd)
MW_TUNNEL_PORT ?= $(word 2,$(ENGINE_SSH_PARTS))
TUNNEL_SSH := ssh $(if $(MW_TUNNEL_PORT),-p "$(MW_TUNNEL_PORT)")
PG_HOST_PORT ?= $(if $(strip $(MW_DOCKER_HOST)),55432,5432)
REDIS_HOST_PORT ?= $(if $(strip $(MW_DOCKER_HOST)),56379,6379)
LOCAL_DOCKER_CONFIG := $(CURDIR)/.docker-local
# Unix sockets are limited to ~104 bytes, so the SSH control socket lives in /tmp, keyed by checkout path.
TUNNEL_SOCK := /tmp/mw-tunnel-$(shell printf '%s' '$(CURDIR)' | shasum | cut -c1-12).sock
TUNNEL_SPEC := $(LOCAL_DOCKER_CONFIG)/tunnel.spec
export PG_HOST_PORT REDIS_HOST_PORT

ifneq ($(strip $(MW_DOCKER_HOST)),)
# Minimal docker config: no osxkeychain credsStore (unusable non-interactively); public images only.
DOCKER_ENV = env -u DOCKER_CONTEXT DOCKER_HOST="$(MW_DOCKER_HOST)" DOCKER_CONFIG="$(LOCAL_DOCKER_CONFIG)" PATH="$(LOCAL_DOCKER_CONFIG)/bin:$$PATH"
else
DOCKER_ENV = env -u DOCKER_HOST DOCKER_CONTEXT=default
endif
COMPOSE = $(DOCKER_ENV) docker compose -f "$(CURDIR)/infra/docker-compose.yml"

.PHONY: up down ps dev check test tunnel tunnel-down docker-config backup restore rehearse-backup

docker-config:
	@mkdir -p "$(LOCAL_DOCKER_CONFIG)/bin"
	@echo '{"credsStore":"mwnone","cliPluginsExtraDirs":["/opt/homebrew/lib/docker/cli-plugins","/usr/local/lib/docker/cli-plugins"]}' > "$(LOCAL_DOCKER_CONFIG)/config.json"
	@printf '#!/bin/sh\n# no-op credential helper: public images only\ncase "$$1" in get) echo "credentials not found in native keychain"; exit 1;; list) echo "{}";; esac\nexit 0\n' > "$(LOCAL_DOCKER_CONFIG)/bin/docker-credential-mwnone"
	@chmod +x "$(LOCAL_DOCKER_CONFIG)/bin/docker-credential-mwnone"

up: docker-config
	$(COMPOSE) up -d --wait
	@$(MAKE) --no-print-directory tunnel

ps:
	@$(COMPOSE) ps --format '{{.Service}} {{.Health}}'

down: tunnel-down
	$(COMPOSE) down

tunnel:
ifneq ($(strip $(MW_DOCKER_HOST)),)
	@set -e; \
	pg_forward="127.0.0.1:5432:127.0.0.1:$$PG_HOST_PORT"; \
	redis_forward="127.0.0.1:6379:127.0.0.1:$$REDIS_HOST_PORT"; \
	spec=$$(printf '%s\n' "$(MW_TUNNEL_HOST)$(if $(MW_TUNNEL_PORT),:$(MW_TUNNEL_PORT))" "$$pg_forward" "$$redis_forward"); \
	if $(TUNNEL_SSH) -S "$(TUNNEL_SOCK)" -O check "$(MW_TUNNEL_HOST)" 2>/dev/null; then \
	  if [ -f "$(TUNNEL_SPEC)" ] && [ "$$(cat "$(TUNNEL_SPEC)")" = "$$spec" ]; then \
	    echo "tunnel already open"; exit 0; \
	  fi; \
	  $(TUNNEL_SSH) -S "$(TUNNEL_SOCK)" -O exit "$(MW_TUNNEL_HOST)"; \
	fi; \
	rm -f "$(TUNNEL_SPEC)"; \
	$(TUNNEL_SSH) -f -N -M -S "$(TUNNEL_SOCK)" -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
	  -L "$$pg_forward" -L "$$redis_forward" "$(MW_TUNNEL_HOST)"; \
	printf '%s\n' "$$spec" > "$(TUNNEL_SPEC)"; \
	echo "tunnel open: localhost:5432 -> $(MW_TUNNEL_HOST):$$PG_HOST_PORT, localhost:6379 -> $(MW_TUNNEL_HOST):$$REDIS_HOST_PORT"
endif

tunnel-down:
ifneq ($(strip $(MW_DOCKER_HOST)),)
	@$(TUNNEL_SSH) -S "$(TUNNEL_SOCK)" -O exit "$(MW_TUNNEL_HOST)" 2>/dev/null || true
	@rm -f "$(TUNNEL_SPEC)"
endif

dev: up
	python3 tools/dev.py

check:
	pnpm check
	cd services/worker && uv run --with pytest pytest -q ../../tools/tests
	cd services/worker && uv run ruff check src tests && uv run mypy src && uv run pytest

test:
	pnpm test
	cd services/worker && uv run --with pytest pytest -q ../../tools/tests
	cd services/worker && uv run pytest

# Backup and restore (P10-01, docs/operations.md). pg_dump/psql run inside the Postgres container.
PG_EXEC = $(COMPOSE) exec -T postgres
BACKUP_DIR ?= backups/$(shell date -u +%Y%m%dT%H%M%SZ)

backup: docker-config
	MW_PG_EXEC='$(PG_EXEC)' node tools/backup/backup.mjs "$(BACKUP_DIR)"

restore: docker-config
	@test -n "$(FROM)" || (echo "usage: make restore FROM=backups/<stamp>"; exit 2)
	MW_PG_EXEC='$(PG_EXEC)' node tools/backup/restore.mjs "$(FROM)"

rehearse-backup: docker-config
	MW_PG_EXEC='$(PG_EXEC)' node tools/backup/rehearse.mjs
