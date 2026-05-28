## Task-Specific Behavior

Implement voucher programs and authenticated voucher issues.

Authentication uses `Authorization: Token <token>`.

Response shapes:

- User: `{ "id", "username", "token", "createdAt" }`
- Program: `{ "id", "code", "valueCents", "budgetCents", "perUserLimit", "createdAt" }`
- Issue: `{ "id", "userId", "externalId", "programId", "programCode", "valueCents", "status", "createdAt" }`
- Summary: `{ "programId", "activeIssueCount", "revokedIssueCount", "issuedCents", "remainingBudgetCents", "activeIssueIds" }`

Rules:

- Program codes are unique.
- Issues look up the program by `programCode`.
- `externalId` is idempotent per authenticated user. Repeating the same
  `externalId` returns HTTP `200` with the original issue and does not spend
  more budget.
- A user can have at most `perUserLimit` active issues for a program.
- Active issues consume program budget. Revoked issues do not consume budget.
- Revoking an issue releases its value back to the program budget and no longer
  counts against the user's limit.
- Revoking another user's issue returns `403`.
- Revoking an already revoked issue returns `409`.
- If budget or per-user limit would be exceeded, return `409` and do not create
  or mutate an issue.
