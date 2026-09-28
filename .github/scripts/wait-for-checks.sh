#!/usr/bin/env bash
# Waits until the CI and E2E jobs have finished on a commit and fails unless every one of them
# succeeded. The Release workflow runs it before it tags or publishes anything, so a release is
# only ever cut from a commit that passed both workflows (docs/RELEASING.md).
#
# Usage: wait-for-checks.sh <sha>
# Env: GH_TOKEN (checks: read), GITHUB_REPOSITORY; optional REQUIRED_CHECKS (newline separated
# job names), WAIT_INTERVAL (seconds, default 30), WAIT_TIMEOUT (seconds, default 3600).
set -euo pipefail

sha="${1:?usage: wait-for-checks.sh <sha>}"
interval="${WAIT_INTERVAL:-30}"
timeout="${WAIT_TIMEOUT:-3600}"
# The job names of .github/workflows/ci.yml and e2e.yml; keep them in step when a job is renamed.
required="${REQUIRED_CHECKS:-check
test
integration
acceptance journey
ui gallery (axe, console)}"

deadline=$(($(date +%s) + timeout))
while :; do
  # the latest run of each GitHub Actions check on the commit: "name<TAB>status<TAB>conclusion"
  runs=$(gh api --paginate "repos/${GITHUB_REPOSITORY}/commits/${sha}/check-runs?filter=latest&per_page=100" \
    --jq '.check_runs[] | select(.app.slug == "github-actions") | [.name, .status, (.conclusion // "")] | @tsv')

  pending=()
  failed=()
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    line=$(printf '%s\n' "$runs" | awk -F'\t' -v n="$name" '$1 == n' | head -n 1)
    if [ -z "$line" ]; then
      pending+=("$name (not started)")
      continue
    fi
    status=$(printf '%s' "$line" | cut -f2)
    conclusion=$(printf '%s' "$line" | cut -f3)
    if [ "$status" != "completed" ]; then
      pending+=("$name ($status)")
    elif [ "$conclusion" != "success" ]; then
      failed+=("$name ($conclusion)")
    fi
  done <<< "$required"

  if [ "${#failed[@]}" -gt 0 ]; then
    printf '::error title=Release gate::%s did not pass on %s; nothing is released\n' \
      "$(IFS=,; echo "${failed[*]}")" "$sha"
    exit 1
  fi
  if [ "${#pending[@]}" -eq 0 ]; then
    echo "CI and E2E passed on ${sha}"
    exit 0
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    printf '::error title=Release gate::still waiting after %ss for: %s\n' \
      "$timeout" "$(IFS=,; echo "${pending[*]}")"
    exit 1
  fi
  echo "waiting for: $(IFS=,; echo "${pending[*]}")"
  sleep "$interval"
done
