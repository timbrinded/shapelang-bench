#!/bin/bash
# Active watcher for a long fanout/full run. Exits (→ one completion notification)
# the instant the run hits ANY terminal state: DONE (leaderboard/abort in log),
# CRASH (bun process gone), or STALL (signature frozen ~8 min while alive = hang).
# Usage: watch-run.sh <log-path>
# See memory: actively-watch-long-runs — don't passively wait for the task notification.
set -u
log="${1:?usage: watch-run.sh <log-path>}"
cd "$(dirname "$0")/.." || exit 2
cache="external/code-review-benchmark/offline/results/gpt-5.5/judge-cache.json"
evals="external/code-review-benchmark/offline/results/gpt-5.5/evaluations.json"
prev=""; stall=0; polls=0
while true; do
  if grep -qE 'variant leaderboard|SWEEP ABORTED|SCORING ABORTED' "$log" 2>/dev/null; then
    echo "WATCH: DONE — leaderboard/abort present in $log"; break
  fi
  # bracket trick so this watcher's own cmdline doesn't match
  if ! pgrep -f '[r]un-fanout.ts|[r]un-full.ts' >/dev/null 2>&1; then
    echo "WATCH: bun process exited — read $log for leaderboard or crash"; break
  fi
  prog=$(grep -c '\[.*\] .* shapelang-' "$log" 2>/dev/null)
  scor=$(grep -c 'scoring ' "$log" 2>/dev/null)
  rj=$(ls runs/review/review-var-*/work/review.json 2>/dev/null | wc -l | tr -d ' ')
  cm=$(stat -f %m "$cache" 2>/dev/null || echo 0)
  em=$(stat -f %m "$evals" 2>/dev/null || echo 0)
  sig="$prog|$scor|$rj|$cm|$em"
  if [ "$sig" = "$prev" ]; then stall=$((stall+1)); else stall=0; fi
  prev="$sig"
  if [ "$stall" -ge 16 ]; then
    echo "WATCH: STALL ~8min (sig=$sig) — process alive but frozen; likely hung"; break
  fi
  polls=$((polls+1))
  sleep 30
done
echo "WATCH FINAL: prog=${prog:-?} scoring=${scor:-?} reviewjson=${rj:-?} stall_ticks=$stall polls=$polls"
