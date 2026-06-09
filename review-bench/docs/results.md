# Code-Review Benchmark — Results

Does giving an agentic code reviewer a **Shape** model of the codebase improve the
review? Scored on the independent, open-source **Martian Code Review Bench**
(50 PRs, human golden comments), with a Codex-subscription judge (no API key).

See `docs/review-benchmark.md` for the design and how to run it.

## Setup

- **Two phases.** Phase 1 (prep, not scored): index the PR's whole codebase into
  a Shape model — deterministic `shp ast source` over every supported file **plus**
  an agent authoring higher-level architecture/invariant shapes grounded in the AST.
  Phase 2 (scored): a reviewer agent reviews the PR diff. `baseline` = diff only;
  `shape` = same, but the Shape model is mounted at `./shape` and the agent **pulls**
  from it on demand (MUST use `shp graph`/`shp explain`).
- **Judge:** `codex exec` on the ChatGPT subscription, reusing Martian's verbatim
  judge prompt + our TP/FP/FN math (no API key, no cost).
- **`shp`:** built from the shapelang fixes branch (see below); offline, no bench
  workarounds.
- Reviewer + judge model: `gpt-5.5`. Paired trials per PR (the reviewer is
  nondeterministic); report mean F1 ± spread.

## Headline finding

The way the Shape model is delivered matters more than its content:

| Design | shape − baseline (pooled, paired) |
|---|---|
| **Push** (~35k of pre-selected shapes injected before the diff) | **−11.1 pts** |
| **Pull** (model mounted; agent traverses with `shp` on demand) | **+7.6 pts** |

Pushing a large context blob triggers lost-in-the-middle + steers the reviewer
off ordinary bugs. Pulling lets the agent fetch only what's relevant.

## Clean-pipeline results (pull, built `shp`, 5 trials × 3 PRs, gpt-5.5)

| PR (bug type) | baseline | shape | Δ |
|---|---|---|---|
| grafana#97529 — Go cross-goroutine race | 30.0% (0–50) | **63.3%** (50–67) | **+33.3** |
| cal.com#11059 — TS OAuth contract | 83.6% | **85.7%** | +2.1 |
| sentry#93824 — Python worker-pool race (5 golden, dense) | 31.4% | 18.9% | −12.5 |
| **pooled (n=15 each)** | 48.3% (sd 30.8) | **56.0%** (sd 31.8) | **+7.6** |

**Read it per bug type, not pooled** (n=3 PRs; sd ≈ 31%):

- **Architecture-dependent bug → Shape wins, and is more reliable.** grafana's race
  needs whole-codebase understanding: +33 pts, and shape catches it every trial
  (50–67%) while baseline sometimes misses it entirely (0–50%).
- **Diff-visible contract bug → neutral.** cal.com's mismatch is already exposed by
  the multi-file diff (+2).
- **Dense, hard bug → no help, slightly worse.** sentry (both catch ~1 of 5), shape
  −12, noisy.

## shapelang fixes (ongoing PR)

Bugs were fixed in shapelang, not worked around in the bench:
**timbrinded/shapelang#70** (`fix/ast-offline-parsers-and-module-collisions`):

1. `shp ast source` honors `SHP_TREE_SITTER_ASSET_ROOT` (offline parsers off-binary).
2. Generated module-name collisions (e.g. Python `__init__.py` vs `init.py`) are
   disambiguated with a path hash instead of aborting the whole batch.

The bench builds `shp` from that branch (`bun run review:build-shp`) and runs it
with **zero** parser/collision workarounds. Validated: sentry (13,744 files incl.
971 `__init__`) and grafana (10,433 Go files) both index clean.

## Caveats

- n=3 PRs; grafana/cal.com have few golden comments → coarse F1.
- Single reviewer + judge model (gpt-5.5).
- Pooled +7.6 is within the noise band; the grafana reliability gain is the robust
  signal. Next: more PRs grouped by bug type to make a per-type claim with real n.
