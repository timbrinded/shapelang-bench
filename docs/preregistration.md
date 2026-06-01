# Pre-Registration: Does ShapeLang Reduce Constraint Decay?

Fixes the hypothesis, design, metrics, and decision rules **before** results.

## Background

Dente et al., *Constraint Decay: The Fragility of LLM Agents in Backend Code
Generation* (arXiv 2605.06445), show that agents generate functional backends
under loose specs but degrade sharply as **structural constraints** (Clean
Architecture, database, ORM) accumulate over a fixed API contract — capable
models lose ~30 points of assertion pass-rate from baseline to fully specified,
with data-layer defects (~45% of failures) the leading cause. We replicate that
decay and test whether using **ShapeLang** — a machine-checkable architecture
contract the agent authors and verifies with `shp` — reduces it.

## Question

Across a fixed API under an increasing structural-constraint ladder (L0→L3),
does an agent that uses the ShapeLang skill decay less — in behavioral
conformance and/or structural compliance — than a vanilla control?

## Design (0-shot, per the paper)

- Fixed API per task; a blind behavioral oracle the agent never sees.
- One **single generation** per (task, condition, level). No iteration.
- Constraint ladder: **L0** framework only (in-memory ok) → **L1** +layered
  (Clean) architecture → **L2** +SQLite persistence → **L3** +Sequelize ORM.

## Conditions (A vs B)

- `control` — vanilla Codex, given the spec + the level's structural constraints.
- `shapelang` — the same agent + the same constraints, additionally told to use
  the ShapeLang skill (read `SKILL.md`, author/maintain `shape/*.shape`, run
  `shp`). Codex runs with an isolated `CODEX_HOME` (no skills dir), so the
  control cannot discover ShapeLang. ShapeLang is the only difference.

## Metrics (dual, per the paper)

- **Assert%** (primary, behavioral) — fraction of the original blind assertions
  passed, over non-rig runs.
- **Structural compliance** — the static architecture/DB/ORM verifiers pass
  (the paper's second axis; the surface ShapeLang most directly targets).
- **shp conformance** (shapelang only) — `shp check` + `shp fmt --check` pass on
  the agent's `.shape` (did it actually use the tool).
- **Decay** = metric(L0) − metric(L3), per condition.

## Validity guards

1. `bun run verify-rig` passes: golden references score 1.0 behavioral **and**
   structural at L0/L3; a behavioral mutant is caught (`functional_fail`); a
   structural mutant (upward import) is caught (structure fails, behavior intact).
2. Rig-class failures (install/port/runner/capacity) < 5% and balanced across
   conditions; excluded from metrics, never counted as decay.
3. n ≥ 5 trials per (task, condition, level) for primary claims.

## Decision rule (per task; `p` = two-sided permutation on L3 metrics)

- If `control` does not decay (`Assert%` L0−L3 ≤ 0.02 and structural compliance
  already high), the task cannot test the hypothesis → `no-decay`.
- Otherwise **ShapeLang reduces decay** is supported iff, at L3,
  `shapelang` beats `control` on Assert% (`p < 0.05`) **and** has smaller
  Assert% decay, **or** has materially higher structural-compliance rate.
- A decaying task where shapelang does not beat control is a real negative
  result (`shapelang-not-supported`), reported as such.

## Not claimed

`shp check` passing means the contract is well-formed and the declared structure
holds; it is not a proof of business-rule correctness. The blind oracle measures
behavior independently.
