# Pre-Registration: Does ShapeLang Slow Spec-Conformance Decay Under Feature Bloat?

This fixes the hypothesis, design, metric, and decision rules **before** results.

## Question

Does successive-generation LLM code generation degrade conformance to the
**original spec** as feature bloat accumulates — and does using **ShapeLang**
slow that degradation?

## Design

- **gen 0** — the agent builds the original spec (a fixed API per task).
- **gen k>0** — the agent is handed gen k−1's code plus ONE new feature ticket
  (additive: new endpoints/fields) and implements it. The agent is **not** shown
  the original spec again and is **not** told to preserve behavior — this is the
  point: realistic feature bloat, where the original contract recedes.
- **Every generation is scored against the ORIGINAL spec's blind tests** (the
  agent never sees these tests). The metric is **original-spec conformance** as a
  function of generation.

## Conditions (A vs B only)

- `control` — vanilla coding agent (Codex), given only the spec / feature ticket.
- `shapelang` — the same agent, told to use the ShapeLang skill at its absolute
  path (it reads `SKILL.md`, authors/maintains `shape/*.shape`, and runs the real
  `shp` CLI each generation). ShapeLang is the *treatment*: a machine-checkable
  architecture memory the agent maintains to resist drift.

**Control isolation:** Codex is run with an isolated `CODEX_HOME` that has no
`skills/` directory (the real one symlinks `~/.codex/skills → ~/.claude/skills`),
so the control provably cannot discover ShapeLang. Only the `shapelang` arm's
prompt names the skill path. A `verify-rig`-style empirical check ("list any
shape skills you can see") must confirm the control sees none before a run is
trusted.

## Metric

- **Original-spec conformance** = fraction of the original blind HTTP assertions
  passed, computed only over non-rig runs.
- **Decay** = conformance(gen 0) − conformance(final gen).
- **ShapeLang conformance** (shapelang arm only) = `shp check` + `shp fmt --check`
  pass on the agent's `.shape` model — a secondary signal on whether the agent
  actually used the tool.

## Validity guards

1. `bun run verify-rig` passes (golden references clean; mutant caught) so the
   oracle provably measures code.
2. Residual rig-class failure rate is low (< 5%) and balanced across conditions;
   rig faults (install/port/runner/capacity) are excluded and never counted as
   decay.
3. n ≥ 5 trials per (task, condition) for primary claims; later generations may
   be lower-n if runs are truncated — those verdicts are flagged `underpowered`.

## Decision rule (per task; `p` is a two-sided permutation test on final-gen
conformance)

- If `control` does not decay (`decay ≤ 0.02`), the task **cannot test** the
  hypothesis (no degradation to slow) → reported `no-decay`.
- Otherwise **ShapeLang slows decay** is supported iff
  `conformance(shapelang, final) > conformance(control, final)` with `p < 0.05`
  **and** `decay(shapelang) < decay(control)`.
- A decaying task where shapelang does not beat control is a real negative
  result (`shapelang-not-supported`), not a rig failure.

## Not claimed

`shp check` passing means the architecture contract is well-formed and the
declared structure holds; it is not a proof of business-rule correctness. The
blind oracle measures original-spec behavior independently.
