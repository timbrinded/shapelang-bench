## Task-Specific Behavior

Implement a library circulation API with members, books, copies, loans, returns,
holds, and member summaries.

Authentication uses `Authorization: Token <token>`.

Rules:

- A book has one or more copies.
- A loan checks out one available copy of a book to the authenticated member.
- A member cannot have two active loans for the same book.
- If no copy is available, a member can place a hold.
- Holds are FIFO by creation order.
- Returning a loan makes the copy available unless there is a pending hold; if a
  hold exists, the copy should be assigned to the oldest hold as a new active loan.
- Returned loans do not count as active loans or overdue loans.

Member summary response:

```json
{
  "memberId": "string",
  "activeLoanCount": 1,
  "returnedLoanCount": 0,
  "holdCount": 1,
  "activeBookIds": ["book-id"]
}
```

