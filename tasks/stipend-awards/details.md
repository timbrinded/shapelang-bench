## Task-Specific Behavior

Implement stipend budgets and authenticated awards.

Authentication uses `Authorization: Token <token>`.

Response shapes:

- User: `{ "id", "username", "token", "createdAt" }`
- Stipend: `{ "id", "code", "awardCents", "budgetCents", "perUserLimit", "createdAt" }`
- Award: `{ "id", "userId", "externalId", "stipendId", "stipendCode", "awardCents", "status", "createdAt" }`
- Summary: `{ "stipendId", "activeAwardCount", "rescindedAwardCount", "awardedCents", "remainingBudgetCents", "activeAwardIds" }`

Rules:

- Stipend codes are unique.
- Awards look up the stipend by `stipendCode`.
- `externalId` is idempotent per authenticated user. Repeating the same
  `externalId` returns HTTP `200` with the original award and does not spend
  more budget.
- A user can have at most `perUserLimit` active awards for a stipend.
- Active awards consume stipend budget. Rescinded awards do not consume budget.
- Rescinding an award changes its `status` to exactly `rescinded`.
- Rescinding an award releases its amount back to the stipend budget and no
  longer counts against the user's limit.
- Rescinding another user's award returns `403`.
- Rescinding an already rescinded award returns `409`.
- If budget or per-user limit would be exceeded, return `409` and do not create
  or mutate an award.
