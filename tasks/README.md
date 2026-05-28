# Task Catalog

The suite target is at least five fixed-API generation tasks that expose backend
constraint decay, then compare `baseline` and `shape` prompt conditions.

`commerce-ledger` is implemented now and already shows a useful pattern:

- `baseline L0`: 64/64 assertions
- `baseline L1`: 64/64 assertions
- `baseline L2`: pristine startup failure from dependency/runtime decay
- `baseline L3`: 58/64 assertions with architecture/database/ORM verifier pass
- `shape L3`: 58/64 assertions with architecture/database/ORM verifier pass

The remaining four tasks are designed in `catalog.json`. They should be
implemented only if their behavioral tests force the same failure surfaces:
relational queries, transactional state propagation, auth/ownership, aggregate
summaries, and framework/runtime correctness.

