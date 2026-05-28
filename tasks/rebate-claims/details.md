## Task-Specific Behavior

Implement rebate budgets and authenticated claims.

Authentication uses `Authorization: Token <token>`.

Response shapes:

- User: `{ "id", "username", "token", "createdAt" }`
- Rebate: `{ "id", "code", "payoutCents", "budgetCents", "perUserLimit", "createdAt" }`
- Claim: `{ "id", "userId", "externalId", "rebateId", "rebateCode", "payoutCents", "status", "createdAt" }`
- Summary: `{ "rebateId", "activeClaimCount", "reversedClaimCount", "paidOutCents", "remainingBudgetCents", "activeClaimIds" }`

Rules:

- Rebate codes are unique.
- Claims look up the rebate by `rebateCode`.
- `externalId` is idempotent per authenticated user. Repeating the same
  `externalId` returns HTTP `200` with the original claim and does not spend
  more budget.
- A user can have at most `perUserLimit` active claims for a rebate.
- Active claims consume rebate budget. Reversed claims do not consume budget.
- Reversing a claim releases its payout back to the rebate budget and no longer
  counts against the user's limit.
- Reversing another user's claim returns `403`.
- Reversing an already reversed claim returns `409`.
- If budget or per-user limit would be exceeded, return `409` and do not create
  or mutate a claim.
