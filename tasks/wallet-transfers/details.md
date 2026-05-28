## Task-Specific Behavior

Implement wallet accounts, ledger entries, deposits, idempotent transfers, and
user summaries.

Authentication uses `Authorization: Token <token>`.

Rules:

- Money is represented as integer cents.
- Deposits create one positive ledger entry.
- Transfers create exactly two ledger entries: negative on the source and
  positive on the destination.
- Transfers must be atomic: insufficient funds must not mutate either account.
- `Idempotency-Key` identifies a transfer request. Repeating the same key must
  return the original transfer without changing balances or duplicating ledger
  entries.
- Users can only inspect their own source accounts and statements.

User summary response:

```json
{
  "userId": "string",
  "accountCount": 2,
  "totalBalanceCents": 1200,
  "ledgerEntryCount": 3
}
```

