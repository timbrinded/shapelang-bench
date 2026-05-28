# Methodology

This benchmark is designed to measure constraint decay, not general code
quality.

## Question

Does an explicit Shape contract reduce L3 constraint decay in agent-generated
backend systems?

Shape is treated as a deterministic architecture conformance language. It is not
treated as a proof of application correctness.

## Conditions

- `baseline`: the agent receives the task and structural constraints.
- `shape`: the agent receives the same task and constraints plus an explicit
  Shape architecture contract.

Levels:

- `L0`: fixed API, no meaningful structure constraints.
- `L1`: layered architecture.
- `L2`: layered architecture plus SQLite persistence.
- `L3`: layered architecture plus SQLite plus Sequelize ORM.

## Acceptance Rule

A task is useful primary evidence only when:

- baseline L0 is clean or near-clean;
- baseline L3 has lower behavior pass rate than L0, or fails structure while L0
  passed;
- the failure is not caused by install, startup, local package-manager artifacts,
  or prompt ambiguity;
- Shape L3 has been run against the same task.

## Current Task Classification

| Task | Classification | Reason |
| --- | --- | --- |
| `coupon-redemptions` | Primary signal | Strong behavior decay and Shape recovery. |
| `stipend-awards` | Primary signal | Strong behavior decay and Shape recovery. |
| `grant-budgets` | Primary signal | Structure decay recovered by Shape. |
| `commerce-ledger` | Negative control | Decay exists, Shape currently does not help. |
| `rebate-claims` | Hygiene check | Original Shape failure was a lockfile/package artifact; cleaned source passes. |
| `refund-ledger` | Control | Baseline L3 already passes. |
| `promo-orders` | Control | Baseline L3 already passes. |
| `voucher-issues` | Control | Baseline L3 already passes. |
| `warehouse-lots` | Control | Baseline L3 already passes. |
| `wallet-transfers` | Control candidate | Behavior is too easy in current form. |
| `sprint-board` | Control candidate | Behavior is too easy in current form. |
| `clinic-scheduling` | Quarantine | L0 is not clean enough. |
| `library-circulation` | Quarantine | L0 results have been unstable. |
| `entitlement-gates` | Quarantine | L0 fails too much. |
| `gift-card-redemptions` | Quarantine | L0 has startup and behavior instability. |

## Reporting

Report behavior, structure, health, and failure class separately. A `0/1`
health timeout is not equivalent to a business-rule failure, and should not be
counted as Shape making the source logic worse without a cleaned rerun.
