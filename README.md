# Shapelang Bench

Replicates the **constraint decay** phenomenon from Dente et al., *Constraint
Decay: The Fragility of LLM Agents in Backend Code Generation* (arXiv
2605.06445), and tests whether **ShapeLang** reduces it.

The paper shows agents generate functional backends under loose specs but
degrade sharply as structural constraints (Clean Architecture → database → ORM)
accumulate over a fixed API — capable models lose ~30 points of assertion
pass-rate from baseline to fully specified, mostly via data-layer defects. This
harness reproduces that L0→L3 decay 0-shot, then asks whether an agent that uses
the ShapeLang skill (a machine-checkable architecture contract it maintains with
`shp`) decays less — behaviorally and structurally.

Bun + TypeScript harness; generated candidates are Express/JS on Bun.

## Conditions

- `control` — vanilla Codex, given the spec + the level's structural constraints.
- `shapelang` — the same agent + constraints, told to use the ShapeLang skill at
  its absolute path (read `SKILL.md`, author/maintain `shape/*.shape`, run `shp`).

Codex runs with an **isolated `CODEX_HOME` (no skills dir)** — the real
`~/.codex/skills` symlinks to `~/.claude/skills`, so without isolation the control
could discover ShapeLang. Only the `shapelang` arm's prompt names the skill path.

## Constraint ladder (the decay axis, 0-shot)

- `L0` framework only (in-memory allowed)
- `L1` + layered (Clean) architecture
- `L2` + SQLite persistence
- `L3` + Sequelize ORM

## Dual evaluation (both of the paper's axes)

- **Assert%** — fraction of the original blind HTTP assertions passed.
- **Structural compliance** — static architecture / DB / ORM verifiers.
- **shp conformance** (shapelang) — `shp check` + `shp fmt --check` on the agent's
  `.shape`.

Rig faults (install/port/runner/capacity, start-script path slips) are
classified and excluded — never counted as decay.

## Trust the rig first

```bash
bun run verify-rig
```

Must pass before any result is believed. It asserts each golden reference scores
1.0 behavioral **and** structural at L0/L3 (positive control on both axes), a
behavioral mutant is caught (`functional_fail`), and a structural mutant (upward
import) is caught (structure fails, behavior intact).

## Run the experiment (resumable, 0-shot)

```bash
bun run bench -- --experiment decay --conditions control,shapelang \
  --levels L0,L1,L2,L3 --trials 5 --concurrency 2 \
  --model gpt-5.3-codex-spark --copy-auth true

# inspect the exact prompts each arm receives, without spending Codex:
bun run bench -- --tasks coupon-redemptions --conditions control,shapelang --dry-run true
```

Idempotent and trial-major: re-run the same command to resume after a
rate/capacity pause. Swap `--model gpt-5.5 -c model_reasoning_effort=high` for
stronger tiers. `scripts/auto-resume.sh` re-invokes through capacity windows.

## Analyze

```bash
bun run analyze -- --experiment decay
```

Per-level `Assert%` (bootstrap CIs) + structural-compliance + `shp`-conformance,
rig-health balance, L0→L3 decay per condition, and the pre-registered verdict
(does shapelang reduce decay vs control). Writes `runs/decay/analysis.json`.

## Documents

- `docs/preregistration.md` — hypothesis, design, decision rules.
- `docs/methodology.md` — apparatus and validity guards.
- `docs/constraint-decay-paper.pdf` — the source paper.
- `EXPERIMENTS.md` — rig-hardening record and result status.
