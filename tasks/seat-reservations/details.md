## Task Details

Implement event seat holds with section-level capacity, expiring holds,
idempotent hold creation, confirmation, cancellation, ownership checks, and
capacity summaries.

### Entity Rules

- Usernames are unique. Creating a user returns an opaque `token` used as
  `Authorization: Token <token>` for hold operations.
- Event codes are unique. Section names are unique within an event.
- Section capacities, `holdSeconds`, and `perUserActiveHoldLimit` must be
  positive integers.
- A hold belongs to one user and one event. It may reserve seats in multiple
  sections.
- A hold has status `active`, `confirmed`, `canceled`, or `expired`.
- Hold responses should include `id`, `eventId`, `userId`, `externalId`,
  `status`, `seats`, `expiresAt`, and `reservationId` after confirmation.
- Hold `externalId` is idempotent per user and event. Reposting the same hold
  details returns the existing hold. Reposting the same user, event, and
  `externalId` with different seats returns `409`.

### Capacity Rules

- Active holds and confirmed reservations both consume section capacity.
- Canceled and expired holds do not consume capacity.
- Creating a hold must atomically verify capacity across all requested sections.
  A multi-section hold either reserves every requested seat or no seats.
- A user may not have more than `perUserActiveHoldLimit` active holds for the
  same event.
- Confirming a hold consumes the seats permanently as a reservation and clears it
  from the active-hold count.
- Canceling an active hold releases all of its seats.
- Expiring holds at `now` marks active holds with `expiresAt <= now` as
  `expired` and releases all of their seats.

### Ownership And State Rules

- Only the hold owner can confirm or cancel a hold.
- Confirming a canceled, expired, or already confirmed hold returns `409`.
- Canceling a canceled, expired, or confirmed hold returns `409`.
- Confirming an active hold at or after its `expiresAt` returns `409`; the hold
  should no longer consume capacity after expiration is processed.

### Summary Shape

`GET /api/events/{eventId}/summary?now=<iso>` returns:

```json
{
  "eventId": "event-id",
  "sections": [
    {
      "name": "floor",
      "capacity": 3,
      "activeHeld": 0,
      "confirmed": 0,
      "available": 3
    }
  ],
  "activeHoldIds": [],
  "confirmedHoldIds": [],
  "canceledHoldIds": [],
  "expiredHoldIds": []
}
```

Sections must be returned in creation order. Hold id arrays must be oldest first
within each status group.

This task intentionally combines ownership, idempotency, multi-section atomic
capacity checks, time-based expiration, per-user active limits, terminal states,
and aggregate summaries. The conformance tests are designed to catch partial
updates and summary drift.
