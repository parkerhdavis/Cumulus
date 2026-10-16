#!/bin/sh
# Entrypoint for the Cumulus Obsidian Sync (headless) container.
#
# One vault per container. On startup:
#   1. repair ownership of the state volume and the vault directory (the
#      container starts as root; Docker auto-creates missing bind sources
#      as root:root, which would otherwise lock the sync user out of its
#      own vault)
#   2. log in — reuses the auth token persisted in /state when present,
#      otherwise logs in with OBSIDIAN_EMAIL/OBSIDIAN_PASSWORD from .env
#   3. create the remote vault when missing (skipped with
#      OBSIDIAN_CREATE_REMOTE=false — rename the remote label to match the
#      vault instead)
#   4. link the local vault to the remote vault (ob sync-setup)
#   5. keep the folder in sync with `ob sync --continuous`
# All ob invocations drop to the sync user (gosu) — root never writes vault
# or state files.
#
# Config syncing carries .obsidian/ (theme, plugins, plugin data, hotkeys) so
# machines stay consistent the same way they do with desktop sync. ob's
# sync-setup defaults to NO config syncing, so this is enforced explicitly
# (all eight categories) on every start, not just at setup. A headless client
# carries those files without running the plugins itself.
#
# If login fails and the account uses 2FA, do the login interactively once and
# retry the container — the token then persists in the state volume:
#   docker compose -f <compose-file> run --rm --entrypoint sh <service>
#   su -s /bin/sh "1000:1000" -c 'ob login --email <email>'

set -eu

RUN_UID="${OBSIDIAN_UID:-1000}"
RUN_GID="${OBSIDIAN_GID:-1000}"
VAULT_PATH="/vaults/${OBSIDIAN_VAULT_NAME}"
DEVICE_NAME="${OBSIDIAN_DEVICE_NAME:-cumulus}"

echo "[obsidian-sync] vault: ${OBSIDIAN_VAULT_NAME}"

run() {
	# gosu resets $HOME to the target user's home (/home/node in the base
	# image), which would hide the persisted auth token in /state
	gosu "$RUN_UID:$RUN_GID" env HOME=/state "$@"
}

# Repair ownership only when the top-level owner is wrong, so healthy vaults
# pay no recursive traversal on start.
fix_owner() {
	[ "$(stat -c '%u:%g' "$1")" = "$RUN_UID:$RUN_GID" ] || chown -R -- "$RUN_UID:$RUN_GID" "$1"
}

# ob writes its config to /state/.config/obsidian-headless; repair /state as
# a whole (auth token, per-vault sync config, and this directory together)
fix_owner /state
[ -d /state/.config/obsidian-headless ] || { mkdir -p /state/.config/obsidian-headless; fix_owner /state; }

# The vault directory must be mounted
if [ ! -d "${VAULT_PATH}" ]; then
	echo "[obsidian-sync] vault directory ${VAULT_PATH} is not mounted, check the compose bind" >&2
	exit 1
fi
fix_owner "${VAULT_PATH}"

# --- 2. login -------------------------------------------------------------

# The "already logged in" probe hits the network, so transient failures (e.g.
# ten containers probing the API at the same instant on recreate) must not be
# mistaken for a missing session. Retry with growing sleeps before concluding
# anything — a fast loop here helped trip Obsidian's per-account rate limiter
# on 2026-10-16 (all nine containers logged in simultaneously after a state
# volume reset, and the account spent the night "Please wait a moment").
LOGGED_IN=no
probe_sleep=15
for _ in 1 2 3; do
	probe_out=$(run ob sync-list-remote 2>&1) && { LOGGED_IN=yes; break; }
	case "$probe_out" in *"No account logged in"*) break ;; esac
	sleep $probe_sleep
	probe_sleep=$((probe_sleep * 2))
done

if [ "${LOGGED_IN}" != "yes" ]; then
	if [ -z "${OBSIDIAN_EMAIL:-}" ] || [ -z "${OBSIDIAN_PASSWORD:-}" ]; then
		echo "[obsidian-sync] not logged in and OBSIDIAN_EMAIL/OBSIDIAN_PASSWORD not set" >&2
		echo "[obsidian-sync] if the account uses 2FA, log in interactively once:" >&2
		echo "[obsidian-sync]   docker compose -f <compose-file> run --rm --entrypoint sh ${OBSIDIAN_VAULT_NAME}" >&2
		exit 1
	fi
	# Jitter the start so a fleet-wide state reset doesn't fire every
	# container's first login at the same instant (PID-based; $RANDOM is
	# not available in dash).
	echo "[obsidian-sync] no session yet — staggering login by up to 45s"
	sleep $(( $$ % 45 ))
	login_sleep=30
	for _ in 1 2 3 4 5; do
		echo "[obsidian-sync] logging in..."
		if run ob login --email "${OBSIDIAN_EMAIL}" --password "${OBSIDIAN_PASSWORD}"; then
			break
		fi
		echo "[obsidian-sync] login attempt failed — retrying in ${login_sleep}s" >&2
		sleep $login_sleep
		login_sleep=$((login_sleep * 2))
		[ $login_sleep -gt 300 ] && login_sleep=300
	done
	run ob sync-list-remote >/dev/null 2>&1 || {
		echo "[obsidian-sync] login did not hold after retries" >&2
		echo "[obsidian-sync] if the account uses 2FA, log in interactively once:" >&2
		echo "[obsidian-sync]   docker compose -f <compose-file> run --rm --entrypoint sh ${OBSIDIAN_VAULT_NAME}" >&2
		exit 1
	}
fi

# --- helpers: parse ob's --json output with node (POSIX sh has no jq) ------

REMOTE_EXISTS=$(run ob sync-list-remote --json | node -e '
	let d = "";
	process.stdin.on("data", (c) => (d += c)).on("end", () => {
		let j = JSON.parse(d);
		let all = [...(j.vaults || []), ...(j.shared || [])];
		console.log(all.some((v) => v.name === process.argv[1]) ? "yes" : "no");
	});
' "${OBSIDIAN_VAULT_NAME}") || {
	echo "[obsidian-sync] remote vault listing failed after login" >&2
	exit 1
}

LOCAL_CONFIGURED=$(run ob sync-list-local --json | node -e '
	let d = "";
	process.stdin.on("data", (c) => (d += c)).on("end", () => {
		let j = JSON.parse(d);
		console.log((j.vaults || []).some((v) => v.path === process.argv[1]) ? "yes" : "no");
	});
' "${VAULT_PATH}")

# --- 3. remote vault ------------------------------------------------------

if [ "${REMOTE_EXISTS}" != "yes" ]; then
	if [ "${OBSIDIAN_CREATE_REMOTE:-true}" != "true" ]; then
		echo "[obsidian-sync] remote vault \"${OBSIDIAN_VAULT_NAME}\" does not exist and OBSIDIAN_CREATE_REMOTE=false" >&2
		echo "[obsidian-sync] rename the remote vault label to match the vault (or sync-create-remote manually)" >&2
		exit 1
	fi
	if [ -z "${OBSIDIAN_E2EE_PASSWORD:-}" ]; then
		echo "[obsidian-sync] cannot create end-to-end encrypted vault without OBSIDIAN_E2EE_PASSWORD" >&2
		exit 1
	fi
	echo "[obsidian-sync] creating remote vault..."
	run ob sync-create-remote --name "${OBSIDIAN_VAULT_NAME}" --encryption end-to-end --password "${OBSIDIAN_E2EE_PASSWORD}"
fi

# --- 4. link the local vault ---------------------------------------------

if [ "${LOCAL_CONFIGURED}" != "yes" ]; then
	echo "[obsidian-sync] linking local vault to remote (device: ${DEVICE_NAME})..."
	set -- run ob sync-setup --vault "${OBSIDIAN_VAULT_NAME}" --path "${VAULT_PATH}" --device-name "${DEVICE_NAME}" --json
	if [ -n "${OBSIDIAN_E2EE_PASSWORD:-}" ]; then
		set -- "$@" --password "${OBSIDIAN_E2EE_PASSWORD}"
	fi
	"$@"
else
	echo "[obsidian-sync] already configured — syncing"
fi

# --- 5. config syncing (enforced on every start) --------------------------

# ob sync-setup records an empty configs list, so enable all available
# categories explicitly. Runs after setup, every start, so the setting
# survives both fresh links and state carried over from older images.
run ob sync-config --path "${VAULT_PATH}" --configs "app,appearance,appearance-data,hotkey,core-plugin,core-plugin-data,community-plugin,community-plugin-data"

# --- 6. continuous sync ----------------------------------------------------

exec gosu "$RUN_UID:$RUN_GID" env HOME=/state ob sync --path "${VAULT_PATH}" --continuous