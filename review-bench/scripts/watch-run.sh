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
# review-bench/scripts/ -> cd up TWO to the repo root, where external/ (the Martian
# submodule) lives; log paths are passed relative to the repo root by callers.
cd "$(dirname "$0")/../.." || exit 2
# stat differs: GNU uses -c (%s size, %Y mtime); BSD/macOS uses -f (%z, %m).
# BSD-only probes silently returned 0 on Linux, freezing the signature and
# false-alarming STALL on every healthy run.
fsize() { stat -c %s "$1" 2>/dev/null || stat -f %z "$1" 2>/dev/null || echo 0; }
fmtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; }
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
  lsz=$(fsize "$log")    # log size — grows as ANY run type progresses
  lmt=$(fmtime "$log")
  cm=$(fmtime "$cache")  # judge cache — grows during fanout scoring
  em=$(fmtime "$evals")
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
