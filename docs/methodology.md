# Methodology

This benchmark measures whether **successive-generation code generation degrades
conformance to the original spec under feature bloat**, and whether **ShapeLang**
slows that decay. It is not a general code-quality benchmark.

## Question

Does original-spec conformance rot as an LLM agent piles on features over
successive generations, and does using ShapeLang (a maintained, `shp`-checked
architecture model) slow the rot?

## Apparatus

- Fixed original spec per task (API + business rules) with a **blind** HTTP test
  suite the agent never sees.
- **gen 0** builds the original spec. **gen k>0** adds the k-th new feature
  (additive endpoints/fields) on top of gen k−1's code. The agent is not re-shown
  the original spec and is not told to preserve behavior.
- Every generation is evaluated against the original blind tests →
  **original-spec conformance** vs generation.

## Conditions

- `control`: vanilla Codex (spec / feature ticket only).
- `shapelang`: Codex told to use the ShapeLang skill (reads `SKILL.md`, authors
  and maintains `shape/*.shape`, runs `shp` each generation).

Codex runs in an isolated `CODEX_HOME` (no skills dir), so the control cannot see
ShapeLang; the shapelang arm is pointed at the skill by absolute path. This is
the only difference between arms.

## Metrics and failure classification

- Original-spec conformance (blind oracle pass rate), over non-rig runs.
- `shp` conformance for the shapelang arm (did the agent keep a valid model?).
- `failureClass`: rig classes (`rig_*`) are excluded and retried/resumed;
  functional classes (`functional_fail`, `boot_crash`, `health_timeout`,
  `oracle_exception`, `none`) are real code properties. Server logs/exit codes
  are retained for auditability. A start-script path mismatch is auto-corrected
  (it is packaging, not behavior) so it cannot masquerade as decay.

## Validity guards

1. `bun run verify-rig` passes (golden references clean; mutant caught).
2. Rig-failure rate < 5% and balanced across conditions.
3. n ≥ 5 trials per (task, condition); thinner later generations are flagged
   `underpowered`.

## Decision rule

See `docs/preregistration.md`. In brief: a task is evidence only if `control`
actually decays; ShapeLang "slows decay" requires shapelang final-generation
conformance significantly above control **and** smaller decay. Single trials are
anecdotes, not evidence.

## Reporting

Conformance, decay, `shp` conformance, and failure class are reported
separately. A rig failure is never counted as decay.
