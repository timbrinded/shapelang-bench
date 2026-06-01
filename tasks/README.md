# Tasks

Five fixed-spec backend tasks for the constraint-decay experiment. Each directory
contains:

- `openapi.yaml` — the API contract shown to the agent.
- `details.md` — the business rules and response shapes.
- `reference/` — a known-correct, layered+Sequelize implementation used **only**
  as a positive control for the blind oracle and structural verifiers
  (`bun run verify-rig`); never shown to the agent.

The blind behavioral oracles live in `src/behaviors/<id>.ts` and are never given
to the agent. The same spec is generated under each constraint level (L0→L3); the
oracle measures conformance, and the static architecture/DB/ORM verifiers measure
structural compliance.

| task | domain | assertions |
| --- | --- | --- |
| `coupon-redemptions` | coupon budget + per-user limit accounting | 31 |
| `stipend-awards` | stipend award + rescission accounting | 31 |
| `grant-budgets` | grant budget + claim accounting | 31 |
| `rebate-claims` | rebate claim + reversal accounting | 31 |
| `commerce-ledger` | inventory-backed ordering | 64 |

See `../docs/preregistration.md` for the experiment design.
