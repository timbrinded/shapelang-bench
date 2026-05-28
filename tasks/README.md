# Task Catalog

The suite target is fixed-API generation tasks that expose backend constraint
decay across multiple language profiles, then compare `baseline` and `shape`
prompt conditions.

The same task OpenAPI and black-box conformance tests are reused across the
language profiles. Language-specific prompt pressure comes from the HTTP,
SQLite, and ORM stack selected for each profile:

- `javascript`: Express, SQLite, Sequelize
- `python`: FastAPI, `sqlite3`, SQLAlchemy
- `go`: `net/http` ServeMux, `database/sql`, GORM
- `rust`: axum, SQLx SQLite, SeaORM

The accepted JavaScript signal tasks are recorded in `catalog.json`. The newest
candidate tasks are intentionally more involved before calibration:

- `seat-reservations`: 63 expected assertions around multi-section capacity,
  active hold limits, ownership, expiration, idempotency, and summaries.
- `work-queue-leases`: 74 expected assertions around priority ordering,
  exclusive leases, retries, release, expired-lease reaping, dead letters, and
  summaries.

Candidate tasks should graduate only after L0 controls are clean or near-clean,
L3 shows behavior or structure decay, and failures are not install/startup
artifacts or prompt ambiguity.
