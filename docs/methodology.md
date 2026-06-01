# Methodology

This benchmark replicates the **constraint decay** phenomenon (Dente et al.,
arXiv 2605.06445) and tests whether **ShapeLang** reduces it. It is not a general
code-quality benchmark.

## Question

As structural constraints accumulate over a fixed API (L0→L3), does an agent
using the ShapeLang skill maintain original-spec conformance and structural
compliance better than a vanilla control?

## Apparatus

- Fixed API contract per task; a blind HTTP oracle the agent never sees.
- One 0-shot generation per (task, condition, level).
- Constraint ladder: L0 framework only → L1 +layered (Clean) architecture →
  L2 +SQLite persistence → L3 +Sequelize ORM. Express on Bun throughout.
- Dual evaluation, as in the paper: behavioral `Assert%` **and** static
  architecture/DB/ORM verifiers. Plus `shp` conformance for the shapelang arm.

## Conditions

- `control`: vanilla Codex (spec + level constraints). Skills isolated via a
  clean `CODEX_HOME`, so it cannot discover ShapeLang.
- `shapelang`: same prompt + an instruction to use the ShapeLang skill at its
  absolute path (author/maintain `shape/*.shape`, run `shp`). The only difference.

## Metrics and failure classification

- `Assert%` (behavioral, partial-credit primary metric, over non-rig runs).
- Structural compliance (architecture/DB/ORM verifiers) — the axis ShapeLang
  most directly targets.
- `shp` conformance (shapelang): did the agent keep a valid `.shape`.
- `failureClass`: rig classes (`rig_*`) are excluded and retried/resumed;
  functional classes (`functional_fail`, `boot_crash`, `health_timeout`,
  `oracle_exception`, `none`) are genuine code properties. A start-script path
  slip is auto-corrected so it cannot masquerade as decay.

## Validity guards

1. `bun run verify-rig` passes (golden references clean on both axes; behavioral
   and structural mutants caught).
2. Rig-failure rate < 5% and balanced across conditions.
3. n ≥ 5 trials per cell; thinner cells flagged `underpowered`.

## Decision rule

See `docs/preregistration.md`: a task is evidence only if `control` actually
decays; ShapeLang "reduces decay" requires beating control at L3 on `Assert%`
(permutation `p < 0.05`, smaller decay) or materially higher structural
compliance. Single trials are anecdotes, not evidence.

## Reporting

Behavior, structure, `shp` conformance, and failure class are reported
separately. A rig failure is never counted as decay.
