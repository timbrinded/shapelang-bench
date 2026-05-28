## Task-Specific Behavior

Implement coupon campaigns and authenticated orders.

Authentication uses `Authorization: Token <token>`.

Response shapes:

- User: `{ "id", "username", "token", "createdAt" }`
- Campaign: `{ "id", "code", "discountCents", "budgetCents", "perUserLimit", "createdAt" }`
- Order: `{ "id", "userId", "externalId", "campaignId", "subtotalCents", "discountCents", "status", "createdAt" }`
- Summary: `{ "campaignId", "activeOrderCount", "canceledOrderCount", "spentCents", "remainingBudgetCents", "activeOrderIds" }`

Rules:

- Campaign codes are unique.
- `externalId` is idempotent per authenticated user. Repeating the same
  `externalId` returns HTTP `200` with the original order and does not spend
  more budget.
- A user can have at most `perUserLimit` active orders for a campaign.
- Campaign budget is consumed by active orders only.
- A canceled order releases its discount back to the campaign budget and no
  longer counts against the user's limit.
- Canceling another user's order returns `403`.
- Canceling an already canceled order returns `409`.
- If budget or per-user limit would be exceeded, return `409` and do not create
  or mutate an order.
