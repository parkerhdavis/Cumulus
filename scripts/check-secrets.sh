#!/bin/sh
# check-secrets — fail when any value from .env appears in tracked history.
#
# The leak this exists for: .env.example carried real Obsidian credentials from
# #39 (2026-10-12) until acca5ee, on a public repo. The scrub fixes the tip;
# only refusing to commit them again prevents the next one.
#
# Usage: scripts/check-secrets.sh [commit...] — with no arguments it checks the
# commits on HEAD that no remote ref has yet. Each .env value (minus the
# non-secret allowlist below, and anything under 8 characters) is searched as a
# fixed string in every given commit. Extend ALLOW_KEY only for keys whose
# values are genuinely publishable — never to silence a real hit.
set -u

ENV_FILE="${ENV_FILE:-.env}"

if [ ! -f "$ENV_FILE" ]; then
	echo "check-secrets: no $ENV_FILE — nothing to check"
	exit 0
fi

if [ $# -gt 0 ]; then
	commits="$*"
else
	commits=$(git rev-list HEAD --not --remotes 2>/dev/null)
fi

if [ -z "$commits" ]; then
	echo "check-secrets: no new commits to check"
	exit 0
fi

# Keys whose values are legitimately publishable. Keys only, never values.
allow_key() {
	case "$1" in
		*_TZ | *_PATH | *_BASE | *_VERSION | *_UID | *_GID | BASE_DOMAIN) return 0 ;;
		*) return 1 ;;
	esac
}

n_commits=$(printf '%s\nplus-1' $commits | wc -l)
fail=0
n_values=0
while IFS= read -r line || [ -n "$line" ]; do
	case "$line" in '' | '#'*) continue ;; esac
	case "$line" in [A-Za-z_]*=*) ;; *) continue ;; esac
	key=${line%%=*}
	value=${line#*=}
	case "$value" in
		\'* | \"*) value=${value#?} ;;
	esac
	case "$value" in
		*\' | *\") value=${value%?} ;;
	esac
	[ -n "$value" ] || continue
	[ "${#value}" -ge 8 ] || continue
	if allow_key "$key"; then
		continue
	fi
	n_values=$((n_values + 1))
	for c in $commits; do
		added=$(git show --format= --unified=0 "$c" | grep '^+' || true)
		short=$(git rev-parse --short "$c")
		if printf '%s\n' "$added" | grep -F -q -e "$value"; then
			fail=1
			echo "check-secrets: FAIL — value of $key added in commit $short:"
			printf '%s\n' "$added" | grep -F -e "$value" | sed 's/^/  /' | head -3
		fi
	done
done <"$ENV_FILE"

if [ "$fail" -ne 0 ]; then
	echo
	echo "check-secrets: a .env value reached the tracked tree. Rotate the secret"
	echo "and scrub the files; never silence this check by editing values around it."
	exit 1
fi

echo "check-secrets: clean — $n_values secret value(s) searched across $n_commits commit(s)"