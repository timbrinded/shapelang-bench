#!/bin/bash
# Active watcher for a long fanout / full / reindex run. Exits (→ one completion
# notification) the instant the run hits ANY terminal state: DONE (leaderboard or
# "Phase 1 complete" or an abort marker in the log), CRASH (bun process gone), or
# STALL (progress signature frozen for the threshold while the process is alive).
#
# Usage: watch-run.sh <log-path> [stall-minutes]
#   stall-minutes default 8 (fanout/full: log grows ~1/min, judge-cache updates during
#   scoring). For a REINDEX pass 30 — authoring agents run silently 10-20 min and
#   runProcess caps each at 30 min, so a shorter threshold false-alarms (it once did).
#
# The signature combines LOG size+mtime (universal: every run type grows its log as it
# progresses) with the judge artifacts (fanout scoring writes these while the log is
# quiet). Frozen across ALL of them for the threshold == genuinely stuck.
# See memory: actively-watch-long-runs.
set -u
log="${1:?usage: watch-run.sh <log-path> [stall-minutes]}"
stall_polls=$(( ${2:-8} * 2 ))   # polls are 30s
cd "$(dirname "$0")/.." || exit 2
cache="external/code-review-benchmark/offline/results/gpt-5.5/judge-cache.json"
evals="external/code-review-benchmark/offline/results/gpt-5.5/evaluations.json"
prev=""; stall=0; polls=0
while true; do
  if grep -qE 'variant leaderboard|Phase 1 complete|SWEEP ABORTED|SCORING ABORTED' "$log" 2>/dev/null; then
    echo "WATCH: DONE — terminal marker present in $log"; break
  fi
  # bracket trick so this watcher's own cmdline doesn't match
  if ! pgrep -f '[r]un-fanout.ts|[r]un-full.ts|[i]ndex-shapes.ts' >/dev/null 2>&1; then
    echo "WATCH: bun process exited — read $log for result or crash"; break
  fi
  lsz=$(stat -f %z "$log" 2>/dev/null || echo 0)   # log size — grows as ANY run type progresses
  lmt=$(stat -f %m "$log" 2>/dev/null || echo 0)
  cm=$(stat -f %m "$cache" 2>/dev/null || echo 0)  # judge cache — grows during fanout scoring
  em=$(stat -f %m "$evals" 2>/dev/null || echo 0)
  sig="$lsz|$lmt|$cm|$em"
  if [ "$sig" = "$prev" ]; then stall=$((stall+1)); else stall=0; fi
  prev="$sig"
  if [ "$stall" -ge "$stall_polls" ]; then
    echo "WATCH: STALL ~$(( stall_polls / 2 ))min (sig=$sig) — process alive but frozen; likely hung"; break
  fi
  polls=$((polls+1))
  sleep 30
done
echo "WATCH FINAL: logsize=${lsz:-?} stall_ticks=$stall polls=$polls — $(tail -1 "$log" 2>/dev/null)"
