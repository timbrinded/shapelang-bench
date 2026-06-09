# Shapelang Bench

Benchmark harness for testing whether explicit Shape contracts reduce constraint
decay in agent-generated backend services.

The harness keeps each task's HTTP API fixed, varies the structural constraints
in the prompt, and evaluates generated candidates with both black-box HTTP tests
and static conformance checks.

The harness itself runs on Bun and TypeScript. The current benchmark tasks still
generate Express/JavaScript candidates; TypeScript task variants are future work.

## Current Signal Tasks

| Task | Role | Current one-trial observation |
| --- | --- | --- |
| `coupon-redemptions` | Primary behavior signal | Baseline L3 decays from `31/31` to `13/31`; Shape L3 recovers `31/31`. |
| `stipend-awards` | Primary behavior signal | Baseline L3 decays from `31/31` to `24/31`; Shape L3 recovers `31/31`. |
| `grant-budgets` | Primary structure signal | Baseline L3 passes behavior but fails structure; Shape L3 passes both. |
| `commerce-ledger` | Negative control | Baseline L3 decays from `64/64` to `58/64`; Shape L3 currently does not recover. |
| `rebate-claims` | Harness hygiene check | Source passes after lockfile cleanup; original Shape run exposed package-artifact contamination. |

Additional task drafts are kept under `tasks/` and `prompts/`, but should be
treated as controls or quarantine cases until their L0 baselines are stable.

## Requirements

- Bun on `PATH`, or set `BUN_BIN=/path/to/bun`.
- Run `bun install` once to install the TypeScript checker used by the harness.
- Codex CLI on `PATH` for agent runs.
- Shape CLI is optional for now; the current verifier checks generated Shape
  artifacts structurally rather than invoking `shp`.

## Generate Prompts

```bash
bun src/generate-prompts.ts
```

## Run Trials

By default, the runner uses an isolated `HOME` and `CODEX_HOME` for every trial.
It does not copy your Codex auth into run directories unless you explicitly pass
`--copy-auth true`.

```bash
bun src/run-codex.ts --task coupon-redemptions --condition baseline --levels L0,L3 --trials 1 --model gpt-5.4-mini --copy-auth true
bun src/run-codex.ts --task coupon-redemptions --condition shape --levels L3 --trials 1 --model gpt-5.4-mini --copy-auth true
```

## Summarize And Calibrate

```bash
bun src/summarize.ts
bun src/calibrate.ts
```

Calibration accepts a task only when L0 is clean or near-clean, L3 decays, and
the failure is not an install/startup artifact or prompt ambiguity.

## Evaluation Hygiene

Generated candidates are copied into a clean evaluation directory before install.
The evaluator strips `node_modules`, `.env`, package-manager lockfiles, SQLite
databases, and Git metadata so agent-side package artifacts do not contaminate
benchmark results.

See `docs/methodology.md` and `EXPERIMENTS.md` for the current interpretation of
the local experiments.

## Code-Review Benchmark (Martian)

A separate, two-phase benchmark measures whether Shape improves AI **code
review**, scored by the independent open-source **Martian Code Review Bench** so
results are directly comparable to CodeRabbit, Bugbot, Greptile, Qodo, and
others. Phase 1 indexes a PR's project into a Shape model (preparation, cached,
not scored); Phase 2 runs a Shape-aware review agent (the only scored phase),
comparing a `baseline` reviewer against a `shape` reviewer. Start with the
end-to-end gate:

```bash
bun run review:smoke
```

See `docs/review-benchmark.md` for the full workflow and prerequisites.
