## Task-Specific Behavior

Implement promotion budgets and authenticated orders.

Authentication uses `Authorization: Token <token>`.

Response shapes:

- User: `{ "id", "username", "token", "createdAt" }`
- Promotion: `{ "id", "code", "discountCents", "budgetCents", "perUserLimit", "createdAt" }`
- Order: `{ "id", "userId", "externalId", "promotionId", "promoCode", "subtotalCents", "discountCents", "status", "createdAt" }`
- Summary: `{ "promotionId", "activeOrderCount", "canceledOrderCount", "discountedCents", "remainingBudgetCents", "activeOrderIds" }`

Rules:

- Promotion codes are unique.
- Orders look up the promotion by `promoCode`.
- `externalId` is idempotent per authenticated user. Repeating the same
  `externalId` returns HTTP `200` with the original order and does not spend
  more budget.
- A user can have at most `perUserLimit` active orders for a promotion.
- Active orders consume promotion budget. Canceled orders do not consume budget.
- Canceling an order releases its discount back to the promotion budget and no
  longer counts against the user's limit.
- Canceling another user's order returns `403`.
- Canceling an already canceled order returns `409`.
- If budget or per-user limit would be exceeded, return `409` and do not create
  or mutate an order.
