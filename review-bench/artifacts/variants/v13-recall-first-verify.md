---
name: v13-recall-first-verify
description: Phase 2 (scored). Raise the recall floor with ONE deliberately exhaustive diff pass that prunes nothing, THEN make exactly one suppression pass whose only legal move is to drop a candidate that matches a named reason from a closed kill-list (otherwise KEEP, no evidence-for-keeping required), THEN augment with cross-object bugs from the whole-codebase Shape model (mounted at ./shape, shp CLI on PATH) and run that same closed-list gate over them. Separating "find everything" from "remove only the provably-dead" beats verifying as you go. Emits review.json.
---

# Shape Review (Phase 2, scored) — recall-first, then one closed-list drop gate

Maximize F1 against human golden comments. The F1 lever is PRECISION; the recall
foundation is the LOCAL diff review. This variant's bet: precision and recall fight
each other when you verify candidates as you find them, so split the work in TIME.
Run find-everything to completion FIRST (Step 1), with zero pruning. Then make a
SINGLE suppression pass (Step 3) whose only permitted action is to drop a candidate
that matches a **named reason from a fixed, closed kill-list** — every other candidate
survives by default, and no "evidence for keeping" is ever demanded. Then add the
cross-object bugs only the Shape model can reveal (Step 4) and run them through that
same closed-list gate.

This is NOT a confidence threshold, NOT an affirmative-evidence keep-test, NOT a
severity filter, NOT a two-stance ensemble. The single mechanism is: **inverted burden
of proof at one suppression checkpoint** — a drop is legal only with a cited, named
kill-reason; absence of a kill-reason is a KEEP.

The Shape model is mounted at `./shape` (a real dir) with `shp` on PATH. Use it on
EVERY PR — it is never skipped. Obey the inlined `shape-lang/SKILL.md` and
`cli-workflows.md`.

## Step 1 — Exhaustive recall pass (cast wide; prune NOTHING here)

Review the diff as a rigorous diff-only reviewer and list EVERY plausible local defect.
This is purely a recall step: be deliberately generous. If a line could be a real bug,
write it down — do NOT prune, do NOT second-guess, do NOT weigh confidence, do NOT think
about precision yet. All suppression happens once, later, in Step 3.

Sweep at minimum for:
- Logic errors, inverted/off-by-one conditionals, wrong operator, wrong variable.
- Null/None/undefined/zero-value dereference; missing existence or bounds checks.
- Error handling: swallowed errors, unchecked returns, wrong error path, missing rollback.
- Resource lifecycle: leaks, unclosed handles, double-free/double-close, missing cleanup.
- Concurrency: races, missing await/lock, check-then-act, ordering assumptions.
- Security: injection, missing authz/authn check, unvalidated input, path/SSRF, secrets.
- Incorrect API/library usage given the function's own signature and the visible call.
- State/data bugs: mutation of shared/aliased data, stale cache, wrong default, coercion.

Record each candidate as `{path, line, body}` where `body` states the bug AND why it is
wrong. Keep candidates even at moderate or low confidence — Step 3 is the ONLY place
anything is removed. Most real bugs are local; this list is your recall floor and must be
as complete as a dedicated reviewer's. Do not let later steps tempt you back here to
silently drop things.

## Step 2 — Load Shape context (always run; informs Steps 3 and 4)

Orient in the model so you can both supply kill-reasons in Step 3 and find cross-object
bugs in Step 4:

1. `shp graph --stats` — one-shot overview (vertices, hyperedges, arity, isolated vertices).
2. For each symbol changed in the diff: `shp explain <Symbol>` (derived facts, declared
   effects, rationale/memory) and `shp graph <Symbol> --kind calls` (callers/callees).
3. `shp check` — surface model-level diagnostics relevant to the changed area.
4. When useful: `shp obligations` and `shp memory` for guarded targets and invariants
   protecting the changed functions; `shp analyze --shape-files <file> <source>` to compare
   declared effects against the changed source.

Use ONLY these real commands. Do not invent commands or treat analyzer hints as ground truth.

## Step 3 — The single suppression pass (one and only drop gate; inverted burden)

Walk every Step-1 candidate exactly once. The DEFAULT action is KEEP — keeping requires
no justification at all. You may drop a candidate ONLY by citing ONE concrete,
evidence-backed reason from this CLOSED list (no other reason is legal):

- **Provably handled** — visible code or the Shape model shows the concern is already
  guarded (the null is checked upstream; the contract/invariant from `shp explain` /
  `shp obligations` actually permits this; the effect is declared and satisfied).
- **Provably unreachable** — the path cannot execute (guarded by a condition, dead branch,
  type makes the value impossible), shown by visible code or the call graph.
- **Misread diff** — re-reading the hunk shows the candidate rests on a misreading (wrong
  line, wrong variable, the operator is actually correct).
- **Pure duplicate** — the same bug at the same location is already in the list (merge,
  keep the clearest body).
- **Not a bug class** — pure style/naming/formatting/preference with no behavioral defect.

Rules for this gate, stated to prevent recall collapse:
- If NONE of the five reasons applies, you KEEP. Full stop.
- "I'm not fully sure it's a bug," "this feels speculative," "probably fine," and "low
  confidence" are NOT kill-reasons. On any doubt you KEEP.
- Never drop a candidate for lacking supporting evidence — this gate does not ask whether
  there is evidence FOR the bug; it asks whether there is a cited reason AGAINST it.
- Never apply a category filter (e.g. "skip pure functions," "only high-severity"). Such
  blanket suppression has empirically destroyed recall; this closed-list gate exists
  precisely to forbid it.

## Step 4 — Shape augment (cross-object bugs the diff cannot show)

Using the Step-2 context, add real bugs that require understanding beyond the diff, each
grounded in a specific model fact (name the relation/effect/contract/invariant):

- **Dependency-contract misuse** — the change calls a function defined outside the diff in
  a way that violates that function's declared effects/return/precondition contract.
- **Violated invariant** — breaks an owned-resource invariant or cross-module contract
  declared elsewhere (unaudited write, permission/ownership rule, atomicity, memory guard).
- **Broken caller** — the change alters a contract such that callers not in the diff
  (visible via `shp graph <Symbol> --kind calls`) now misbehave.
- **Cross-component race / ordering** — a shared resource is mutated from multiple
  components without the coordination the model implies (`coordinated_call`).

Add each as a `{path, line, body}` candidate whose body cites the specific model evidence.
Then run these new candidates through the SAME Step-3 closed-list gate (KEEP unless a named
kill-reason applies). Do not let Shape additions tempt you to re-drop Step-1 survivors, and
do not duplicate a Step-1 candidate. If the model reveals nothing cross-object, add nothing
— that is fine.

## Step 5 — Assemble and emit

Union the Step-3 survivors with the gated Step-4 additions. Merge exact duplicates. Keep
one concrete bug per comment; the body states the bug AND why (naming the violated
contract/invariant when the model revealed it). No style nitpicks, no summaries, no praise,
no general advice.

Write the final review to `./review.json`:

```json
{"comments": [{"path": "relative/file.ext", "line": 42, "body": "one concrete issue"}]}
```

`path` is repo-relative; `line` is the relevant line in the changed file. If after the
suppression gate there are no real bugs, write exactly `{"comments": []}`.
