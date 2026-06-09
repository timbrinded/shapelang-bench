---
name: v9-severity-triage
description: Phase 2 (scored). Run the FULL diff+Shape analysis unchanged, then classify every surviving candidate into exactly one category bucket and emit ONLY the high-severity defect buckets (correctness, security, data-integrity, concurrency). Style, naming, speculative-architecture, refactor, praise, and summary buckets are analyzed but never emitted — aligning output to the bug-only golden distribution. Writes review.json.
---

# Shape Review (Phase 2, scored) — Severity-Triaged Emission

Maximize F1 against human golden comments. The golden comments are almost entirely
*bugs* — concrete correctness, security, data-integrity, and concurrency defects, not
style or design opinions. Precision is the F1 lever: a diff-only reviewer sits near 50%
precision because it emits low-severity notes the golden set never rewards, and the judge
counts each as a false positive.

This variant's distinctive mechanism is a **category gate on emission**. You run the full
diff + Shape analysis exactly as a maximal-recall reviewer would, then sort every surviving
candidate into exactly one category bucket and emit ONLY the high-severity defect buckets.
This is NOT a confidence threshold, NOT an evidence-citation requirement, and NOT a
"drop the false positives" pass — it is a classification of each finding by *what kind of
finding it is*, keeping every bug-category finding and discarding only the explicitly
non-bug categories (style/naming/speculative-architecture/refactor/praise/summary).

The category gate is the ONLY filter. It is additive and never blanket-suppressive: it
removes a finding solely because you can name the non-bug bucket it belongs to, never
because of low confidence and never by category of code (no "skip pure functions"). When
you cannot place a finding in a non-bug bucket, it is a defect and it stays IN.

The Shape model is mounted at `./shape` (a real dir) with `shp` on PATH; use it on every
PR — never skip it. Work in one pass, in this order.

## Step 1 — Thorough diff review FIRST (recall foundation; do not shortchange)

Before touching Shape, review the diff exactly as a rigorous diff-only reviewer would and
write down EVERY candidate defect you can find. Most real bugs are local, so this is the
recall foundation and must be as complete as a dedicated reviewer's. Hunt for:

- Logic errors, wrong conditionals, inverted booleans, off-by-one, wrong operators.
- Null/None/undefined/unset access; missing existence or bounds checks.
- Error handling: swallowed errors, wrong error path, unhandled rejection/exception,
  missing rollback/cleanup on failure.
- Resource leaks: unclosed handles/locks/connections/transactions.
- Concurrency: races, missing synchronization, await/ordering mistakes, double-free.
- Security: injection, missing authz/authn check, unsafe deserialization, secret leakage,
  path traversal, missing input validation on a trust boundary.
- Data integrity: lost writes, wrong default that corrupts state, missing transaction,
  type coercion that loses data, incorrect API usage that mutates the wrong thing.

Capture each as a draft finding with `path`, `line`, and a one-line statement of the bug
and why. Do this fully before spending any effort on the model. Do NOT filter yet —
filtering happens only at Step 3, and only by category.

## Step 2 — Shape augment (cross-object recall the diff can't reach)

Now use the model for what the diff alone cannot show. Run:

```bash
shp graph --stats
```

for a one-shot overview, then for each symbol changed in the diff:

```bash
shp explain <Symbol>
shp graph <Symbol> --kind calls
```

Add real defects that require cross-object understanding, each grounded in concrete model
output:

- **Dependency-contract misuse** — the diff calls a function (defined outside the diff) in
  violation of its declared effects/return contract.
- **Violated invariant** — the change breaks an owned-resource invariant or cross-module
  contract (unaudited write, permission/ownership rule, required atomicity) declared
  elsewhere in the model.
- **Broken caller** — the change alters a contract in a way that breaks callers not present
  in the diff.
- **Cross-component race / ordering** — a shared resource is mutated from multiple
  components without the coordination the model implies.

If `shp explain` / `shp graph` is ambiguous, you may run `shp obligations`, `shp memory`,
`shp check`, or `shp analyze <files>` to confirm a guarded change, memory constraint, or
declared effect before adding the finding. Append each Shape-grounded finding to the same
draft list, naming the specific contract/invariant the model revealed. Still do NOT filter.

## Step 3 — The category gate (the precision lever)

You now have one combined draft list (local + cross-object). Two short passes.

**3a. Validity check (lightweight, keep-on-doubt).** Drop a candidate ONLY when you can
cite concrete evidence it is not a real bug at all: the "violated" contract actually
permits the usage, the path is provably unreachable, the model/code shows the concern is
already handled, or it is an exact duplicate of another finding. **When unsure whether it
is a real bug, KEEP it.** Never second-guess a solid local bug — over-dropping destroys
recall. This pass is deliberately minimal; the distinctive filtering is 3b.

**3b. Category gate (the distinctive step).** Sort each surviving candidate into exactly
one bucket and emit ONLY the IN buckets. The decision is "what category of finding is
this," not "how confident am I."

IN — emit (these match the golden distribution):
- **Correctness** — the code produces wrong behavior/output for valid input, or crashes
  (logic error, null deref, off-by-one, wrong condition, bad error handling, resource leak
  that affects behavior).
- **Security** — exploitable weakness (injection, missing authz, unsafe input on a trust
  boundary, secret exposure, traversal).
- **Data integrity** — persisted/shared state can be corrupted, lost, or left inconsistent
  (lost write, missing transaction/rollback, wrong default that corrupts).
- **Concurrency** — race, deadlock, ordering hazard, missing synchronization on shared
  state.

OUT — do NOT emit (these inflate the candidate set and tank precision):
- **Style / formatting** — naming, casing, layout, comment wording, idiom preference.
- **Naming** — "rename X for clarity" with no behavioral consequence.
- **Speculative architecture** — "consider extracting/splitting/abstracting", design
  opinions, "this might not scale" with no concrete present defect.
- **Refactor / cleanliness** — dead-code removal, dedup, simplification suggestions that do
  not fix a defect.
- **Pure praise, summaries, or questions.**

Tie-break (keeps the gate additive, never suppressive): **a finding is removed by 3b only
when you can name which OUT bucket it falls in AND state why it has no
correctness/security/data-integrity/concurrency consequence.** If a finding plausibly has
such a consequence — a "naming" issue that actually causes the wrong variable to be used,
a "refactor" that removes a real null-guard — it belongs in an IN bucket; keep it. A
finding that fits no OUT bucket is by definition a defect and stays IN. Borderline-severity
defects stay IN. The gate exists to remove pure non-bug noise, never to remove anything
that could be a real bug.

Then write each surviving finding's `body` so it states the concrete defect and *why it is
a defect* (name the violated contract/invariant when the model revealed it). A reader must
see the bug, not a preference.

## Output contract (required)

Write the final triaged review to `./review.json`:

```json
{"comments": [{"path": "relative/file.ext", "line": 42, "body": "one concrete issue"}]}
```

One defect per comment; `path` relative; `line` the offending line; `body` states the bug
and why. No style nitpicks, no naming/refactor suggestions, no speculative architecture, no
summaries, no praise. If after the category gate there are no high-severity defects, emit
`{"comments": []}`.
