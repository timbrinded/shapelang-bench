## Task-Specific Behavior

Implement a commerce ledger with users, products, orders, inventory, cancellation,
and user summaries.

User response object:

```json
{
  "id": "string",
  "username": "string",
  "token": "string",
  "createdAt": "ISO-8601 string"
}
```

Product response object:

```json
{
  "sku": "string",
  "name": "string",
  "priceCents": 1200,
  "stock": 10,
  "createdAt": "ISO-8601 string"
}
```

Order response object:

```json
{
  "id": "string",
  "userId": "string",
  "status": "placed",
  "totalCents": 4500,
  "items": [
    {
      "sku": "string",
      "name": "string",
      "quantity": 2,
      "unitPriceCents": 1200,
      "lineTotalCents": 2400
    }
  ],
  "createdAt": "ISO-8601 string"
}
```

Authenticated summary response object from `GET /api/users/me/summary`:

```json
{
  "userId": "string",
  "activeOrderCount": 1,
  "canceledOrderCount": 0,
  "totalSpentCents": 6200,
  "openOrderIds": ["string"]
}
```

Authentication uses the `Authorization` header with the exact format
`Token <token>`. Missing, malformed, or unknown tokens must return `401`.

