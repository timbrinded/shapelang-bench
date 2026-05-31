# Shapelang Bench

Benchmark for one question: **does successive-generation LLM code generation
degrade conformance to the original spec as feature bloat accumulates, and does
using ShapeLang slow that decay?**

Each task has a fixed original spec and a **blind** HTTP test suite the agent
never sees. The agent builds the spec (gen 0), then over successive generations
is handed its own prior code plus a new feature ticket (additive bloat). Every
generation is re-scored against the **original** tests, so the metric is
original-spec conformance over time. Two arms: a vanilla agent (`control`) and
the same agent told to use the ShapeLang skill (`shapelang`).

The harness runs on Bun + TypeScript; generated candidates are Express/JS on Bun.

## Conditions

- `control` — vanilla Codex, given only the spec / feature ticket.
- `shapelang` — same agent, told to use the ShapeLang skill at its absolute path;
  it reads `SKILL.md`, authors/maintains `shape/*.shape`, and runs the real `shp`
  CLI each generation.

Codex runs with an **isolated `CODEX_HOME` (no skills dir)** — the real
`~/.codex/skills` symlinks to `~/.claude/skills`, so without isolation the control
could discover ShapeLang. Only the `shapelang` arm's prompt names the skill path.

## Trust the rig first

```bash
bun run verify-rig
```

Must pass before any result is believed. It asserts a hand-written, known-correct
golden reference per task scores 1.0 on the blind oracle (positive control) and
that a deliberately broken mutant is caught and classed `functional_fail`
(negative control). Rig faults (install/port/runner/capacity, and start-script
path slips) are classified and excluded — never counted as decay.

## Run the experiment (resumable)

```bash
# control vs shapelang, 5 tasks, n=5, ~5 generations of feature bloat each
bun run bench -- --experiment decay --conditions control,shapelang \
  --trials 5 --concurrency 2 --model gpt-5.3-codex-spark --copy-auth true

# inspect the exact prompts each arm receives, without spending Codex:
bun run bench -- --tasks coupon-redemptions --conditions control,shapelang --dry-run true
```

Idempotent and trial-major: re-run the same command to resume after a
rate/capacity pause; a partial run still yields ≥1 trial per chain. Swap
`--model gpt-5.5 -c model_reasoning_effort=high` for stronger tiers.

A driver that re-invokes `bench` through capacity windows lives at
`scripts/auto-resume.sh`.

## Analyze

```bash
bun run analyze -- --experiment decay
```

Reports original-spec conformance per generation (bootstrap 95% CIs), rig-health
balance, per-arm decay trajectories, and the pre-registered verdict (does
shapelang reduce decay vs control). Writes `runs/decay/analysis.json`.

## Tasks

Five fixed specs with blind oracles: `coupon-redemptions`, `stipend-awards`,
`grant-budgets`, `rebate-claims`, `commerce-ledger`. Each has
`tasks/<id>/openapi.yaml`, `details.md`, a `reference/` golden implementation, and
`features.json` (the ordered feature-bloat tickets).

## Documents

- `docs/preregistration.md` — hypothesis, design, metric, decision rules.
- `docs/methodology.md` — apparatus and validity guards.
- `EXPERIMENTS.md` — rig-hardening notes and result status.
