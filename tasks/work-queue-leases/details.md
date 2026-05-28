## Task Details

Implement a durable work queue with workers, queues, idempotent job creation,
exclusive leases, retries, release, and expired-lease reaping.

### Entity Rules

- Worker names are unique. Creating a worker returns an opaque `token` used as
  `Authorization: Token <token>` for lease mutations.
- Queue names are unique. `maxAttempts` and `leaseSeconds` must be positive
  integers.
- Job `externalId` is unique within a queue. Reposting the same `queueName`,
  `externalId`, `payload`, `priority`, and `runAt` returns the existing job.
  Reposting the same `queueName` and `externalId` with different job details
  returns `409`.
- Jobs have status `queued`, `leased`, `completed`, or `dead`.
- Jobs start with `attempts = 0`. Attempts increment only when a worker claims a
  queued job.

### Claiming Rules

- A claim request leases exactly one ready job from the requested queue.
- A job is ready when its status is `queued` and `runAt <= now`.
- Claim ordering is by highest `priority`, then oldest creation order.
- A successful claim sets status `leased`, records the worker id, increments
  `attempts`, and sets `leaseExpiresAt = now + queue.leaseSeconds`.
- Job responses should include `id`, `queueId`, `externalId`, `payload`,
  `priority`, `runAt`, `status`, `attempts`, and, while leased,
  `leasedByWorkerId` and `leaseExpiresAt`.
- If no ready job exists, return HTTP `204` with an empty body.
- A worker cannot complete, fail, or release a job leased by another worker.

### Completion, Failure, Release, And Reaping

- Completing a job requires an active lease owned by the caller. Completion sets
  status `completed`, stores the result, and removes lease ownership.
- Failing a job requires an active lease owned by the caller. If `attempts` is
  less than `maxAttempts`, set status `queued`, set `runAt` to `retryAt`, and
  clear the lease. If `attempts` is equal to `maxAttempts`, set status `dead`
  and clear the lease.
- Releasing a job requires an active lease owned by the caller. It returns the
  job to status `queued` immediately without changing `runAt` or `attempts`.
- Reaping a queue at `now` clears every lease with `leaseExpiresAt <= now` and
  returns those jobs to status `queued`. Reaping does not change attempts.
- Completed and dead jobs are terminal.

### Summary Shape

`GET /api/queues/{queueId}/summary?now=<iso>` returns:

```json
{
  "queueId": "queue-id",
  "queuedCount": 0,
  "readyCount": 0,
  "scheduledCount": 0,
  "leasedCount": 0,
  "completedCount": 0,
  "deadCount": 0,
  "readyJobIds": [],
  "scheduledJobIds": [],
  "leasedJobIds": [],
  "completedJobIds": [],
  "deadJobIds": []
}
```

`readyJobIds` must use the same priority then creation ordering that claim uses.
`scheduledJobIds`, `leasedJobIds`, `completedJobIds`, and `deadJobIds` should be
oldest first within each group.

This task intentionally combines idempotency, priority ordering, ownership,
lease expiry, retry limits, terminal states, and aggregate summaries. Passing the
OpenAPI shape alone is not enough; the conformance tests exercise the full state
machine.
