---
name: v10-caller-impact
description: Phase 2 (scored). Do a full diff-only review for recall, then aim Shape at one pattern only — enumerate the real callers of every changed contract and flag the out-of-diff callers the change silently breaks — adding precise cross-object findings without broad speculative scans. Emits review.json.
---

# Shape Review (Phase 2, scored) — caller-impact contract analysis

Maximize F1 against human golden comments. Precision is the lever (a diff-only reviewer sits
near 50% precision). Shape's single highest-yield, most-groundable signal here is the
**broken caller**: when a changed symbol's signature, return, error behavior, effect, or
invariant changes, callers that live OUTSIDE the diff silently break. The diff shows the
change; only the whole-codebase model shows who depended on the old behavior. This variant
narrows Shape usage to exactly that pattern — enumerate real callers of each changed
contract, check each for diff-invisible breakage — and refuses broad cross-object scans that
dilute precision. Work in one pass, in order. The Shape model is mounted at `./shape` (real
dir) with `shp` on PATH; use it on every PR.

## Step 1 — Thorough diff review FIRST (recall; never shortchange this)

Before touching Shape, review the diff exactly as a rigorous diff-only reviewer would and
write down EVERY real defect visible in the changed lines themselves: logic errors,
null/None/undefined, off-by-one, wrong conditionals/operators, error handling, concurrency,
resource leaks, security, incorrect API usage, broken edge cases. Most real bugs are LOCAL.
This is the recall foundation and must be as complete as a dedicated reviewer's. Finish it
fully before spending any effort on the model — Shape is additive, never a substitute.

## Step 2 — Identify changed contracts (what callers depended on)

Orient on the model once with `shp graph --stats`. Then, from the diff, list the changed
**symbols** (functions/methods/components) and for each decide whether its CONTRACT changed —
the thing a caller relies on. A contract change is any of:

- **Signature**: params added/removed/reordered/retyped, defaults changed, arity changed.
- **Return**: shape/type/nullability changed, a sentinel/None/empty now returned, or the
  units/meaning of the value changed.
- **Errors**: now throws/raises/returns-error where it did not (or stopped doing so), or
  changes which error.
- **Effect / side effect**: now mutates, writes, locks, or performs I/O — or skips an effect
  it used to perform.
- **Invariant / ordering / state**: changes a pre/postcondition, required call order, or an
  owned-resource invariant declared elsewhere.

For each candidate, confirm the model's understanding with `shp explain <Symbol>` (declared
effects, contracts, evidence); use `shp analyze <source>` when an effect change is in doubt.
If a symbol's contract did NOT change, it has no caller-impact risk — drop it from this track
and move on. Do not invent contract changes that are not in the diff.

## Step 3 — Enumerate the real callers of each changed contract

For every changed symbol whose contract changed in Step 2, list its real callers:

```bash
shp graph <Symbol> --kind calls
```

This yields the `calls` hyperedges incident to the symbol — the callers that depend on it.
Keep only callers that are NOT themselves in the diff (callers inside the diff are Step 1's
job; trust it and do not double-report). If this command shows no external callers, there is
simply no caller-impact bug to add for this symbol — that is the expected case, not a gap.
This enumeration is the whole mechanism: do not broaden into general cross-object pattern
hunting beyond the callers this command returns.

## Step 4 — Check each external caller for diff-invisible breakage (additive)

For each external caller from Step 3, ask whether the Step 2 contract delta breaks it:

- **Now-wrong assumption**: caller passes/handles arguments or reads the return per the OLD
  signature/shape (wrong arg position, missing new required arg, treats a now-nullable return
  as always-present, assumes the old units/meaning).
- **Unhandled new outcome**: callee now throws/raises/returns an error or sentinel the caller
  does not catch or check, so the error escapes or a bad value flows downstream.
- **Dropped effect / broken invariant**: callee no longer performs a write/lock/validation/
  audit the caller relied on (or now performs one the caller does not coordinate with), so an
  invariant or ordering the model declares is now violated at the caller.
- **Cross-component coordination**: a shared resource the caller mutates is now also mutated
  by the changed callee without the `coordinated_call`/ownership coordination the model
  implies.

Use `shp explain <Caller>` to confirm what the caller actually relies on before asserting
breakage. Add one comment per broken caller ON TOP OF the Step 1 local findings — never
replace or suppress a local finding. Anchor each comment on the caller's file and line, and
state the exact breakage. Evidence gate: add a caller-impact finding only when the model
shows a concrete dependency on the changed contract AND you can name the precise breakage; if
the relation is ambiguous or you cannot cite the dependency, do NOT add it (an unfounded
cross-object claim is a false positive). This gate is the precision discipline.

Secondary, same-mechanism use only: if a Step 1 local candidate hinges on an out-of-diff
contract (the changed code calls a function whose declared effects/return in the model
contradict its assumption), use `shp explain <Callee>` to confirm and keep that candidate.
Do not use this step as license for open-ended cross-object scanning.

## Step 5 — Verify, CONSERVATIVELY (precision, do not over-drop)

Re-examine every candidate from Steps 1 and 4. Drop one ONLY with concrete evidence it is not
a real bug: the "broken" caller is actually in the diff and already updated; the model shows
the caller never relied on the changed behavior; the path is unreachable; the concern is
already handled. **When unsure, KEEP it** — over-dropping destroyed recall in prior
iterations. Never second-guess a solid local bug from Step 1. Also drop duplicates (same bug
at the same place) and pure style/preference notes.

## Output contract (required)

Write the final review to `./review.json`:

```json
{"comments": [{"path": "relative/file.ext", "line": 42, "body": "one concrete issue"}]}
```

One issue per comment. `path` is repo-relative; `line` is where the bug must be fixed — for a
broken caller, the caller's line. `body` states the bug AND why it is a bug; for caller-impact
findings, name the changed contract and the broken caller (e.g., "X now returns None on miss;
caller Y dereferences it unchecked"). No style nitpicks, no summaries, no praise. No real
bugs → `{"comments": []}`.
