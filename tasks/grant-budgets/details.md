## Task-Specific Behavior

Implement grant budgets and authenticated claims.

Authentication uses `Authorization: Token <token>`.

Response shapes:

- User: `{ "id", "username", "token", "createdAt" }`
- Grant: `{ "id", "code", "awardCents", "budgetCents", "perUserLimit", "createdAt" }`
- Claim: `{ "id", "userId", "externalId", "grantId", "grantCode", "awardCents", "status", "createdAt" }`
- Summary: `{ "grantId", "activeClaimCount", "voidedClaimCount", "awardedCents", "remainingBudgetCents", "activeClaimIds" }`

Rules:

- Grant codes are unique.
- Claims look up the grant by `grantCode`.
- `externalId` is idempotent per authenticated user. Repeating the same
  `externalId` returns HTTP `200` with the original claim and does not spend
  more budget.
- A user can have at most `perUserLimit` active claims for a grant.
- Active claims consume grant budget. Voided claims do not consume budget.
- Voiding a claim releases its award back to the grant budget and no longer
  counts against the user's limit.
- Voiding another user's claim returns `403`.
- Voiding an already voided claim returns `409`.
- If budget or per-user limit would be exceeded, return `409` and do not create
  or mutate a claim.
