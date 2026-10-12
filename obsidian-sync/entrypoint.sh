#!/bin/sh
# Entrypoint for the Cumulus Obsidian Sync (headless) container.
#
# One vault per container. On startup:
#   1. log in — reuses the auth token persisted in /state when present,
#      otherwise logs in with OBSIDIAN_EMAIL/OBSIDIAN_PASSWORD from .env
#   2. create the remote vault when missing (skipped with
#      OBSIDIAN_CREATE_REMOTE=false — name it right instead)
#   3. link the local vault to the remote vault (ob sync-setup)
#   4. keep the folder in sync with `ob sync --continuous`
# Steps 2-3 are skipped when the vault is already configured for this host, so
# a recreated container goes straight to continuous sync from its state.
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
#   ob login --email <email>          (prompts for the code)

set -eu

# ob writes its config to $HOME/.config/obsidian-headless and does not fail
# gracefully when the directory is missing on a fresh state volume
mkdir -p "${HOME}/.config/obsidian-headless"

VAULT_PATH="/vaults/${OBSIDIAN_VAULT_NAME}"
REMOTE_VAULT="${OBSIDIAN_REMOTE_VAULT:-${OBSIDIAN_VAULT_NAME}}"
DEVICE_NAME="${OBSIDIAN_DEVICE_NAME:-cumulus}"

echo "[obsidian-sync] vault: ${OBSIDIAN_VAULT_NAME} (remote: ${REMOTE_VAULT})"

# --- 1. login -------------------------------------------------------------

if ! ob sync-list-remote >/dev/null 2>&1; then
	if [ -z "${OBSIDIAN_EMAIL:-}" ] || [ -z "${OBSIDIAN_PASSWORD:-}" ]; then
		echo "[obsidian-sync] not logged in and OBSIDIAN_EMAIL/OBSIDIAN_PASSWORD not set" >&2
		echo "[obsidian-sync] if the account uses 2FA, log in interactively once:" >&2
		echo "[obsidian-sync]   docker compose -f <compose-file> run --rm --entrypoint sh ${OBSIDIAN_VAULT_NAME}" >&2
		exit 1
	fi
	echo "[obsidian-sync] logging in..."
	if ! ob login --email "${OBSIDIAN_EMAIL}" --password "${OBSIDIAN_PASSWORD}"; then
		echo "[obsidian-sync] login failed — if the account uses 2FA, log in interactively once:" >&2
		echo "[obsidian-sync]   docker compose -f <compose-file> run --rm --entrypoint sh ${OBSIDIAN_VAULT_NAME}" >&2
		exit 1
	fi
fi

# --- helpers: parse ob's --json output with node (POSIX sh has no jq) ------

REMOTE_EXISTS=$(ob sync-list-remote --json | node -e '
	let d = "";
	process.stdin.on("data", (c) => (d += c)).on("end", () => {
		let j = JSON.parse(d);
		let all = [...(j.vaults || []), ...(j.shared || [])];
		console.log(all.some((v) => v.name === process.argv[1]) ? "yes" : "no");
	});
' "${REMOTE_VAULT}")

LOCAL_CONFIGURED=$(ob sync-list-local --json | node -e '
	let d = "";
	process.stdin.on("data", (c) => (d += c)).on("end", () => {
		let j = JSON.parse(d);
		console.log((j.vaults || []).some((v) => v.path === process.argv[1]) ? "yes" : "no");
	});
' "${VAULT_PATH}")

# --- 2. remote vault ------------------------------------------------------

if [ "${REMOTE_EXISTS}" != "yes" ]; then
	if [ "${OBSIDIAN_CREATE_REMOTE:-true}" != "true" ]; then
		echo "[obsidian-sync] remote vault \"${REMOTE_VAULT}\" does not exist and OBSIDIAN_CREATE_REMOTE=false" >&2
		echo "[obsidian-sync] fix OBSIDIAN_REMOTE_VAULT in .env, or create/create-remote manually" >&2
		exit 1
	fi
	if [ -z "${OBSIDIAN_E2EE_PASSWORD:-}" ]; then
		echo "[obsidian-sync] cannot create end-to-end encrypted vault without OBSIDIAN_E2EE_PASSWORD" >&2
		exit 1
	fi
	echo "[obsidian-sync] creating remote vault..."
	ob sync-create-remote --name "${REMOTE_VAULT}" --encryption end-to-end --password "${OBSIDIAN_E2EE_PASSWORD}"
fi

# --- 3. link the local vault ---------------------------------------------

if [ "${LOCAL_CONFIGURED}" != "yes" ]; then
	echo "[obsidian-sync] linking local vault to remote (device: ${DEVICE_NAME})..."
	set -- ob sync-setup --vault "${REMOTE_VAULT}" --path "${VAULT_PATH}" --device-name "${DEVICE_NAME}" --json
	if [ -n "${OBSIDIAN_E2EE_PASSWORD:-}" ]; then
		set -- "$@" --password "${OBSIDIAN_E2EE_PASSWORD}"
	fi
	"$@"
else
	echo "[obsidian-sync] already configured — syncing"
fi

# --- 4. config syncing (enforced on every start) --------------------------

# ob sync-setup records an empty configs list, so enable all available
# categories explicitly. Runs after setup, every start, so the setting
# survives both fresh links and state carried over from older images.
ob sync-config --path "${VAULT_PATH}" --configs "app,appearance,appearance-data,hotkey,core-plugin,core-plugin-data,community-plugin,community-plugin-data"

# --- 5. continuous sync ----------------------------------------------------

exec ob sync --path "${VAULT_PATH}" --continuous