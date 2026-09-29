#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# DLCK LNCH — Gemini credential verification (runs on YOUR machine).
#
# Your key never leaves your computer: this script reads it from the environment
# or from a git-ignored .env file and sends it straight to Google over HTTPS.
# It is never printed, never logged and never written anywhere.
#
# Usage:
#   export GEMINI_API_KEY=...        # or: cp .env.example .env && edit .env
#   ./scripts/verify_gemini.sh
# -----------------------------------------------------------------------------
set -uo pipefail

BASE_URL="${GEMINI_BASE_URL:-https://generativelanguage.googleapis.com}"
MODEL="${GEMINI_MODEL:-gemini-2.5-flash}"

# Load .env if present (never printed).
if [[ -z "${GEMINI_API_KEY:-}" && -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env >/dev/null 2>&1
  set +a
fi

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  cat <<'EOF'
✗ No credential found.

Set it first (it is never echoed):

    read -rs GEMINI_API_KEY && export GEMINI_API_KEY

…or copy .env.example to .env and put the key there (.env is git-ignored).

Create a key at: https://aistudio.google.com/app/apikey
EOF
  exit 2
fi

echo "── 1/2 · validating credential (GET /v1beta/models) ──"
HTTP_CODE=$(curl -sS -o /tmp/dlck_models.json -w '%{http_code}' \
  -H "x-goog-api-key: ${GEMINI_API_KEY}" \
  "${BASE_URL}/v1beta/models" 2>/dev/null)

case "$HTTP_CODE" in
  200)
    COUNT=$(grep -o '"name"' /tmp/dlck_models.json | wc -l | tr -d ' ')
    echo "✓ credential accepted — ${COUNT} models visible"
    ;;
  400|401)
    echo "✗ HTTP ${HTTP_CODE}: the key was rejected as INVALID."
    echo "  → Create a new key at https://aistudio.google.com/app/apikey"
    rm -f /tmp/dlck_models.json; exit 1 ;;
  403)
    echo "✗ HTTP 403: the key exists but is NOT ALLOWED to call this API."
    echo "  → Enable the 'Generative Language API' for the key's project, and"
    echo "    check that no HTTP-referrer / IP restriction is blocking it."
    rm -f /tmp/dlck_models.json; exit 1 ;;
  429)
    echo "✗ HTTP 429: rate limit or quota exceeded. Wait a minute and retry."
    rm -f /tmp/dlck_models.json; exit 1 ;;
  5*)
    echo "✗ HTTP ${HTTP_CODE}: temporary Google server error. Retry shortly."
    rm -f /tmp/dlck_models.json; exit 1 ;;
  000)
    echo "✗ Could not reach ${BASE_URL} at all (network/proxy/firewall)."
    rm -f /tmp/dlck_models.json; exit 1 ;;
  *)
    echo "✗ Unexpected HTTP ${HTTP_CODE}."
    rm -f /tmp/dlck_models.json; exit 1 ;;
esac
rm -f /tmp/dlck_models.json

echo "── 2/2 · test generation (${MODEL}) ──"
HTTP_CODE=$(curl -sS -o /tmp/dlck_gen.json -w '%{http_code}' \
  -X POST \
  -H "x-goog-api-key: ${GEMINI_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"role":"user","parts":[{"text":"Reply with exactly: OK"}]}]}' \
  "${BASE_URL}/v1beta/models/${MODEL}:generateContent" 2>/dev/null)

if [[ "$HTTP_CODE" == "200" ]]; then
  echo "✓ generation succeeded — Gemini is reachable and the key works."
  echo
  echo "RESULT: CREDENTIAL VALID ✅  (the key itself was never displayed)"
  rm -f /tmp/dlck_gen.json
  exit 0
fi

echo "✗ generation failed with HTTP ${HTTP_CODE}."
if [[ "$HTTP_CODE" == "404" ]]; then
  echo "  → Model '${MODEL}' is not available for this key."
  echo "    Try: GEMINI_MODEL=gemini-2.0-flash ./scripts/verify_gemini.sh"
fi
rm -f /tmp/dlck_gen.json
exit 1
