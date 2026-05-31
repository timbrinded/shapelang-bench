#!/usr/bin/env bash
# Autonomous resumable driver for the feature-bloat decay experiment. Re-invokes
# the idempotent bench until the full matrix is measured (non-rig) or the pass
# cap is hit. Capacity/rate holes are retried with adaptive backoff. Runs analyze
# at the end. Set MODEL to switch tiers (e.g. gpt-5.5).
set -u
cd /home/timbo/workspace/personal/shapelang-bench

EXPERIMENT=${EXPERIMENT:-decay}
MODEL=${MODEL:-gpt-5.3-codex-spark}
CONC=${CONC:-2}
TRIALS=${TRIALS:-5}
MAX_PASSES=${MAX_PASSES:-150}
EXTRA_ARGS=${EXTRA_ARGS:-}   # e.g. '-c model_reasoning_effort=high'
RESUME_LOG=/tmp/bench-${EXPERIMENT}-resume.log
RUN_LOG=/tmp/bench-${EXPERIMENT}.log

# 5 tasks x 2 conditions x TRIALS x 5 generations (gen0 + 4 features).
TARGET=$(( 5 * 2 * TRIALS * 5 ))

count_complete() {
  grep -rl '"rigFailure": false' "runs/${EXPERIMENT}" --include=evaluation.json 2>/dev/null | wc -l | tr -d ' '
}

echo "=== auto-resume($EXPERIMENT) start $(date -u +%H:%M:%S) target=$TARGET model=$MODEL ===" >> "$RESUME_LOG"
for i in $(seq 1 "$MAX_PASSES"); do
  before=$(count_complete)
  if [ "$before" -ge "$TARGET" ]; then echo "PASS $i: COMPLETE ($before/$TARGET)" >> "$RESUME_LOG"; break; fi
  bun src/bench.ts --experiment "$EXPERIMENT" --conditions control,shapelang \
    --trials "$TRIALS" --concurrency "$CONC" --model "$MODEL" --copy-auth true \
    --timeoutMs 600000 $EXTRA_ARGS >> "$RUN_LOG" 2>&1
  after=$(count_complete)
  echo "PASS $i $(date -u +%H:%M:%S): $before -> $after / $TARGET" >> "$RESUME_LOG"
  if [ "$after" -ge "$TARGET" ]; then echo "COMPLETE at pass $i" >> "$RESUME_LOG"; break; fi
  if [ "$after" -le "$before" ]; then sleep 180; else sleep 15; fi
done
echo "--- analysis ---" >> "$RESUME_LOG"
bun src/analyze.ts --experiment "$EXPERIMENT" --permutations 10000 --bootstrap 5000 >> "$RESUME_LOG" 2>&1
echo "ANALYSIS_WRITTEN runs/${EXPERIMENT}/analysis.json final=$(count_complete)/$TARGET" >> "$RESUME_LOG"
