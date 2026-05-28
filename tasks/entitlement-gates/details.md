## Task-Specific Behavior

Implement account subscriptions and monthly usage gates.

Response shapes:

- Account: `{ "id", "slug", "createdAt" }`
- Plan: `{ "id", "code", "monthlyQuota", "createdAt" }`
- Subscription: `{ "id", "accountId", "planCode", "status", "startsAt", "canceledAt" }`
- Usage event: `{ "id", "accountId", "units", "occurredAt", "period" }`
- Entitlement: `{ "accountId", "period", "activeSubscriptionId", "planCode", "quota", "used", "remaining", "allowed" }`

Rules:

- Account slugs and plan codes are unique.
- An account can have only one active subscription.
- Canceling a subscription makes it inactive and allows a new subscription.
- Usage is accepted only when the account has an active subscription at
  `occurredAt`.
- `period` is the UTC `YYYY-MM` of `occurredAt`.
- Usage for one month must not count against another month.
- If a usage event would exceed the active plan's monthly quota for its period,
  return `409` and do not persist that usage event.
- Entitlement summaries count only accepted usage events for the requested
  period and only the current active subscription.
