# Tasks

Five fixed-spec backend tasks. Each directory contains:

- `openapi.yaml` — the original API contract shown to the agent at gen 0.
- `details.md` — the original business rules and response shapes.
- `features.json` — the ordered, additive feature-bloat tickets fed one per
  generation (gen 1, gen 2, …).
- `reference/` — a known-correct implementation used **only** as a positive
  control for the blind oracle (`bun run verify-rig`); never shown to the agent.

The blind test oracles live in `src/behaviors/<id>.ts` and are never given to the
agent. Conformance is always measured against the *original* spec, so feature
bloat that silently breaks original behavior shows up as decay.

| task | domain | original assertions |
| --- | --- | --- |
| `coupon-redemptions` | coupon budget + per-user limit accounting | 31 |
| `stipend-awards` | stipend award + rescission accounting | 31 |
| `grant-budgets` | grant budget + claim accounting | 31 |
| `rebate-claims` | rebate claim + reversal accounting | 31 |
| `commerce-ledger` | inventory-backed ordering | 64 |

See `../docs/preregistration.md` for the experiment design.
