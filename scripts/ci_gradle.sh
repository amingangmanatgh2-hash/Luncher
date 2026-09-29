#!/usr/bin/env bash
# Runs a Gradle task and, on failure, republishes the compiler errors as a single
# GitHub Actions annotation so the failure is readable from the API.
set -uo pipefail

LOG_FILE="${LOG_FILE:-gradle-output.log}"

echo "▶ gradle $*"
gradle --no-daemon --console=plain "$@" 2>&1 | tee "$LOG_FILE"
STATUS=${PIPESTATUS[0]}

if [ "$STATUS" -eq 0 ]; then
  echo "✓ gradle $* succeeded"
  exit 0
fi

{
  echo "### Gradle failure: \`$*\`"
  echo ''
  echo '```'
  grep -E '^(e:|w: .*error)' "$LOG_FILE" | head -60
  echo '```'
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

ERRORS=$(grep -E '^e: ' "$LOG_FILE" | head -40)
if [ -z "$ERRORS" ]; then
  ERRORS=$(grep -E -A 12 '(\* What went wrong|FAILURE: Build failed|Execution failed for task|tests completed,)' "$LOG_FILE" | head -60)
fi
if [ -z "$ERRORS" ]; then
  ERRORS=$(tail -n 60 "$LOG_FILE")
fi

ESCAPED=$(printf '%s' "$ERRORS" \
  | head -c 8000 \
  | sed -e 's/%/%25/g' \
  | sed -e ':a' -e 'N' -e '$!ba' -e 's/\r/%0D/g' -e 's/\n/%0A/g')

echo "::error title=gradle $*::${ESCAPED}"
exit "$STATUS"
