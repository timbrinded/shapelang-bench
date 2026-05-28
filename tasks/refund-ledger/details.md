## Task-Specific Behavior

Implement an invoice ledger with payments and refunds.

Response shapes:

- Customer: `{ "id", "email", "createdAt" }`
- Invoice: `{ "id", "customerId", "number", "amountCents", "status", "createdAt" }`
- Payment: `{ "id", "invoiceId", "amountCents", "createdAt" }`
- Refund: `{ "id", "invoiceId", "amountCents", "idempotencyKey", "createdAt" }`
- Ledger: `{ "customerId", "invoiceCount", "paidCents", "refundedCents", "netCollectedCents", "openInvoiceIds", "entries" }`

Rules:

- Customer emails and invoice numbers are unique.
- Payments cannot make total paid for an invoice exceed its amount.
- Refunds cannot make total refunded for an invoice exceed total paid.
- Repeating the same refund `Idempotency-Key` returns HTTP `200` with the
  original refund and does not change ledger totals.
- Invoice status is `open`, `paid`, or `refunded`: `paid` when paid equals
  invoice amount and refunded is zero; `refunded` when refunded is greater than
  zero; otherwise `open`.
- Ledger entries are ordered by creation time and include all invoices, payments,
  and refunds for the customer.
- `openInvoiceIds` includes only invoices whose status is `open`.
