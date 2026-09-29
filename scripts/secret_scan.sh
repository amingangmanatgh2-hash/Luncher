#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# DLCK LNCH — pre-commit secret scan.
#
# Fails (exit 1) when anything that looks like a credential is about to be
# committed. Run it manually or install it as a git hook:
#
#   ln -sf ../../scripts/secret_scan.sh .git/hooks/pre-commit
#
# It scans tracked/staged files only — never your local .env.
# -----------------------------------------------------------------------------
set -uo pipefail

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
FAILED=0

cd "$(git rev-parse --show-toplevel)" || exit 1

# Files under version control (or staged), excluding this script and the docs
# that legitimately talk about key formats.
FILES=$(git ls-files | grep -v -E '^(scripts/secret_scan\.sh|README\.md|docs/.*\.md|\.env\.example)$')

check() {
  local name="$1" pattern="$2"
  local hits
  hits=$(printf '%s\n' "$FILES" | xargs -r grep -InE "$pattern" 2>/dev/null)
  if [[ -n "$hits" ]]; then
    echo "${RED}✗ possible ${name}:${RESET}"
    echo "$hits"
    FAILED=1
  else
    echo "${GREEN}✓ no ${name}${RESET}"
  fi
}

echo "── DLCK LNCH secret scan ───────────────────────────────"

check "Google API key (AIza…)"        'AIza[0-9A-Za-z_-]{20,}'
check "Google OAuth client secret"    'GOCSPX-[0-9A-Za-z_-]{10,}'
check "generic api_key assignment"    '(api[_-]?key|apikey)[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_-]{16,}'
check "bearer token literal"          'Bearer[[:space:]]+[A-Za-z0-9._-]{24,}'
check "private key block"             'BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY'
check "AWS access key"                'AKIA[0-9A-Z]{16}'
check "Slack token"                   'xox[baprs]-[0-9A-Za-z-]{10,}'

# Files that must never be tracked at all.
echo "── forbidden files ─────────────────────────────────────"
FORBIDDEN=$(git ls-files | grep -E '(^|/)(\.env$|\.env\..*|local\.properties|secrets\..*|credentials\..*|.*\.keystore|.*\.jks|.*\.pem|.*\.key)$' | grep -v '\.env\.example' || true)
if [[ -n "$FORBIDDEN" ]]; then
  echo "${RED}✗ these files must not be committed:${RESET}"
  echo "$FORBIDDEN"
  FAILED=1
else
  echo "${GREEN}✓ no credential files tracked${RESET}"
fi

echo "────────────────────────────────────────────────────────"
if [[ $FAILED -eq 1 ]]; then
  echo "${RED}SECRET SCAN FAILED — commit blocked.${RESET}"
  echo "${YELLOW}Remove the secret, rotate it, and store it outside the repository.${RESET}"
  exit 1
fi
echo "${GREEN}SECRET SCAN PASSED${RESET}"
