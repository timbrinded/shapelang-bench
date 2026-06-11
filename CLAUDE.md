# CLAUDE.md — shapelang-bench

Benchmark rig testing whether ShapeLang (Shape contracts) improves AI codegen
(`src/`, constraint-decay harness) and AI code review (`review-bench/`, scored
by the Martian Code Review Bench). The product of this repo is BENCHMARK
NUMBERS — treat anything that could silently corrupt a number as a critical bug.

## Verify before and after any change

- `bun run typecheck` — must pass.
- `bun test` — must pass (result-integrity suite: scoring math, dataset
  injection, judge cache, eval hygiene, prompt determinism).
- `bun run review:smoke` — hermetic e2e gate, runs offline (no submodules, no
  models), must print `SMOKE PASSED`.

## Hard operational rules (violations have burned us before)

1. NEVER run two benchmark sweeps concurrently. Injection and scoring mutate
   shared JSON files under `external/code-review-benchmark/offline/results/`
   (`benchmark_data.json`, `<model>/candidates.json`, `<model>/evaluations.json`)
   and will race. One sweep at a time. (Authoring variants with a Claude
   Workflow concurrently IS safe — it only writes
   `review-bench/artifacts/variants/*.md`.)
2. NEVER edit `BASELINE_REVIEWER` in `review-bench/skill-prompt.ts` or the
   scored baseline tool data. It is the frozen control every delta is measured
   against.
3. Scoring is serial BY DESIGN. `scoreToolCodex` reads/writes the shared
   `evaluations.json` + `judge-cache.json`; never call it concurrently across
   tools.
4. Trust only n≥3. n=1 per-repo deltas are noise-dominated (proven: v13 on
   discourse went +10.3 at n=1 → −0.3 at n=3). discourse and sentry-greptile
   have only 4 PRs each — wide CIs; never make per-repo claims from them alone.
5. Watch every long run with `review-bench/scripts/watch-run.sh <log>
   [stall-min]`. Runs can wedge silently; default stall threshold 8 min, use 30
   for reindex passes (authoring agents run silently for 10–20 min).
6. Killing a sweep mid-run loses all unscored reviews (reviews are injected and
   scored only after ALL of them finish). Prefer letting the harness abort
   itself (usage-limit guard); re-run after the limit resets.
7. The judge cache persists verdicts keyed by (model, golden, candidate). A
   failed/empty judge call THROWS and is never cached — keep it that way;
   caching a bogus `false` poisons every future run.
8. Anti-overfit protocol: shape skills/indexes are authored from the general
   architecture only — NEVER from the benchmark PRs' diffs or golden bugs.
   Shape is ALWAYS used in the shape condition (no suppression on small diffs).

## Models & external deps

- Reviewer + judge default to `gpt-5.5` via the Codex subscription (env:
  `REVIEW_MODEL` / `JUDGE_MODEL`). gpt-5.2 was retired mid-project and
  confounded everything once — if Codex returns 400 "model not supported", the
  model moved again; regenerate the baseline with the new model before
  comparing anything.
- Real review runs need: git submodules (`git submodule update --init`), the
  built `shp` binary (`bun run review:build-shp`), `gh` (authed), and a
  logged-in Codex CLI. The hermetic smoke needs none of these; real entry
  points preflight and fail fast with remediation steps.

## Where the knowledge lives

- `review-bench/docs/HANDOFF.md` — current state + how to resume the
  optimization loop (read FIRST in any review-bench session).
- `review-bench/docs/golden-goose-log.md` — full research history + FINAL
  verdict (+8.4 F1 pooled at n=3; per-repo ceilings track cross-object bug
  fraction).
- `EXPERIMENTS.md` + `docs/methodology.md` — the constraint-decay harness and
  its calibration rule.
- `plans/` — open implementation plans (gitignored, local-only; see
  `plans/README.md`).
