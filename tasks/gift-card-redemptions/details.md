## Task-Specific Behavior

Implement gift cards and authenticated charges.

Authentication uses `Authorization: Token <token>`.

Response shapes:

- User: `{ "id", "username", "token", "createdAt" }`
- Gift card: `{ "id", "code", "initialBalanceCents", "balanceCents", "createdAt" }`
- Charge: `{ "id", "userId", "externalId", "cardId", "cardCode", "amountCents", "status", "createdAt" }`
- Summary: `{ "cardId", "activeChargeCount", "canceledChargeCount", "spentCents", "balanceCents", "activeChargeIds" }`

Rules:

- Gift card codes are unique.
- `externalId` is idempotent per authenticated user. Repeating the same
  `externalId` returns HTTP `200` with the original charge and does not spend
  more card balance.
- Charges look up the gift card by `cardCode`.
- Active charges consume card balance. Canceled charges do not consume balance.
- If a charge would exceed the remaining balance, return `409` and do not create
  or mutate a charge.
- Canceling another user's charge returns `403`.
- Canceling an already canceled charge returns `409`.
- Canceling a charge restores that amount to the card balance.
