# Constraint Decay Harness Experiments

## Research Baseline

Source checked: [arXiv 2605.06445](https://arxiv.org/abs/2605.06445),
`Constraint Decay: The Fragility of LLM Agents in Backend Code Generation`.

The paper's apparatus is not just "make the app harder." The important shape is:

- keep a fixed API contract;
- add structural constraints incrementally;
- evaluate with both black-box behavioral tests and static conformance checks;
- treat data-layer defects, incorrect query composition, and ORM runtime errors as
  primary failure modes.

The local PDF metadata also points to
`https://anonymous.4open.science/r/constraint-decay`, but that artifact returned
HTTP 403 from this environment and `git ls-remote` did not resolve it.

## Current Calibration Rule

A task counts as useful decay evidence when:

- baseline L0 is clean or near-clean;
- baseline L3 either has a lower behavioral assertion pass rate than L0 or fails
  a static structure check that L0 passed;
- the failure is not an L0 control failure, install failure, or prompt ambiguity;
- Shape L3 has been run so the task is classified as better, worse, or same.

Run:

```bash
bun src/calibrate.mjs
```

## Local Results

Latest calibration:

| Task | Baseline L0 | Baseline L3 | Shape L3 | Finding |
| --- | ---: | ---: | ---: | --- |
| `commerce-ledger` | 64/64 | 58/64 | 58/64 | Behavior decay; Shape same. |
| `coupon-redemptions` | 31/31 | 13/31 | 31/31 | Behavior decay; Shape better. |
| `grant-budgets` | 31/31 | 31/31, structure fail | 31/31, structure pass | Structure decay; Shape better. |
| `rebate-claims` | 31/31 | 30/31 | 0/1 health | Original Shape run failed startup due to package artifacts; cleaned source reran at 31/31. |
| `stipend-awards` | 31/31 | 24/31 | 31/31 | Behavior decay; Shape better. |

Important negative result: adding more domain concepts did not automatically
make a better constraint-decay test. The rejected archive includes noisy controls
(`library-circulation`, `entitlement-gates`, `gift-card-redemptions`) and
too-easy tasks (`warehouse-lots`, `refund-ledger`, `voucher-issues`,
`promo-orders`, plus earlier `sprint-board` and `wallet-transfers`).

## Rig Improvements Made

- Added active task directories with task-local OpenAPI specs and behavior details.
- Added behavior evaluators for the active suite and rejected candidate archive.
- Added task-aware prompt generation:
  `prompts/<task>/<condition>/<level>.md`.
- Added task-aware Codex runner support through `--task`.
- Added task-aware evaluation dispatch.
- Added `calibrate.mjs` to classify which tasks actually qualify as decay
  evidence.
- Replaced skeletal OpenAPI specs for new tasks with response schemas, request
  schemas, path parameters, auth schemes, and scalar validation.

## Follow-Up

The suite now satisfies the requested one-trial calibration target for a seed
suite. The next research step should be repeated trials (`n >= 5`) for primary
tasks and controls, because Shape effects are stochastic in single-agent runs.
