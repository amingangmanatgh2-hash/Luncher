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

emit() {
  # one annotation per line so the whole list survives the API's message limits
  printf '%s\n' "$1" | head -n 45 | while IFS= read -r line; do
    [ -z "$line" ] && continue
    esc=$(printf '%s' "$line" | head -c 900 | sed -e 's/%/%25/g' -e 's/\r//g')
    echo "::error::${esc}"
  done
}

ERRORS=$(grep -E '^e: ' "$LOG_FILE")
if [ -n "$ERRORS" ]; then
  emit "$ERRORS"
else
  emit "$(grep -E -A 10 '(\* What went wrong|FAILURE: Build failed|Execution failed for task|> Task .* FAILED|tests completed)' "$LOG_FILE" | head -n 45)"
  emit "$(tail -n 25 "$LOG_FILE")"
fi
exit "$STATUS"
