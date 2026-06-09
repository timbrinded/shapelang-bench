---
name: v17-recall-caller-anchored
description: Phase 2 (scored). v13's proven recall-first chassis (exhaustive local pass that prunes nothing, then ONE closed-list named-reason drop gate that keeps on doubt) with its open-ended Shape-augment step REPLACED by v10's centered caller-impact mechanism — for every changed contract, enumerate the real out-of-diff callers via `shp graph <Symbol> --kind calls` and flag the ones the change silently breaks, each citing the concrete dependency. The bet: the broken-caller is Shape's single highest-salience, most-groundable cross-object signal (humans flag contract breaks), and centering it — instead of broad cross-object hunting that adds ungrounded false positives on grounding-thin repos — gives cross-object recall without the precision leak. Shape mounted at ./shape, shp on PATH, used on every PR. Emits review.json.
---

# Shape Review (Phase 2, scored) — recall-first chassis + centered caller-impact

Maximize F1 against the human golden comments. Pooled F1 = 2·TP/(C+G): the golden
count G is fixed, so you win by (a) not missing the bugs a human flagged and (b) not
emitting extras a human would not flag. This skill keeps the proven recall-first
chassis — exhaustive local recall up front, then ONE closed-list suppression gate —
and aims Shape at exactly ONE cross-object pattern: the **broken caller**.

The distinctive bet, and the only thing that differs from a pure recall-first skill:
when a changed symbol's contract changes (signature, return, errors, effect, or a
declared invariant), callers that live OUTSIDE the diff silently break. The diff shows
the change; only the whole-codebase model shows who depended on the old behavior. This
is Shape's single highest-yield, most-groundable signal, and it is high-SALIENCE: a
human reviewer almost always flags an API/contract break. Centering Shape on this one
pattern — rather than open-ended cross-object hunting — adds the cross-object bugs that
land in the golden set without the ungrounded speculative findings that tank precision
on repos with a thin authored model.

This is NOT a confidence threshold, NOT a severity filter, NOT a two-stance ensemble,
and NOT a broad cross-object scan. The mechanisms are exactly two: **inverted burden of
proof at one suppression checkpoint** (a drop is legal only with a cited, named
kill-reason; absence of a kill-reason is a KEEP) and **caller-impact enumeration** for
cross-object recall.

The Shape model is mounted at `./shape` (a real dir) with `shp` on PATH. **Use it on
EVERY PR — small diffs included; it is never skipped or suppressed.** Obey the inlined
`shape-lang/SKILL.md` and `cli-workflows.md`. Use ONLY real `shp` commands. Work the
steps in order, then write `./review.json`.

## Step 1 — Exhaustive local recall pass (cast wide; prune NOTHING here)

Review the diff as a rigorous diff-only reviewer and list EVERY plausible local defect
in the changed code. This is purely a recall step: be deliberately generous. If a line
could be a real bug, write it down — do NOT prune, do NOT second-guess, do NOT weigh
confidence, do NOT think about precision yet. All suppression happens once, later, in
Step 4. Most golden bugs are LOCAL, so this list is the recall foundation and must be as
complete as a dedicated reviewer's.

Sweep at minimum for:
- Logic errors, inverted/off-by-one conditionals, wrong operator, wrong variable, swapped args.
- Null/None/undefined/zero-value dereference; missing existence or bounds checks.
- Error handling: swallowed errors, unchecked returns, wrong error path, missing rollback.
- Resource lifecycle: leaks, unclosed handles, double-free/double-close, missing cleanup.
- Concurrency: races, missing await/lock, check-then-act, ordering assumptions.
- Security: injection, missing authz/authn, unvalidated input, path traversal/SSRF, secrets.
- Incorrect API/library usage given the function's own signature and the visible call.
- State/data bugs: mutation of shared/aliased data, stale cache, wrong default, bad coercion.
- Behavior regressions: a changed line alters observable behavior in a way that breaks an edge case.

Record each candidate as `{path, line, body}` where `body` states the bug AND why it is
wrong, naming the exact failing token/value/line. Keep candidates even at moderate or low
confidence — Step 4 is the ONLY place anything is removed. Do not let later steps tempt
you back here to silently drop things.

## Step 2 — Identify the changed contracts (what out-of-diff callers depended on)

Orient once with `shp graph --stats`. Then, from the diff, list the changed **symbols**
(functions/methods/components) and for each decide whether its CONTRACT changed — the
thing a caller relies on. A contract change is any of:

- **Signature** — params added/removed/reordered/retyped, defaults changed, arity changed.
- **Return** — shape/type/nullability changed, a sentinel/None/empty now returned, or the
  units/meaning of the value changed.
- **Errors** — now throws/raises/returns-error where it did not (or stopped doing so), or
  changes which error.
- **Effect / side effect** — now mutates, writes, locks, or performs I/O — or skips an
  effect it used to perform.
- **Invariant / ordering / state** — changes a pre/postcondition, required call order, or an
  owned-resource invariant the model declares.

For each candidate symbol, confirm the model's understanding with `shp explain <Symbol>`
(declared effects, contracts, evidence); use `shp analyze --shape-files <model.shape>
<source>` when an effect change is in doubt, and `shp obligations` / `shp memory` when the
change touches a guarded/owned resource. If a symbol's contract did NOT change, it has no
caller-impact risk — drop it from this track and move on. Do not invent contract changes
that are not in the diff. Use ONLY real `shp` commands; do not treat an analyzer hint as
ground truth — read the cited fact first.

## Step 3 — Caller-impact: enumerate real callers, flag the ones the change breaks (cross-object recall)

This REPLACES open-ended cross-object hunting. For every changed symbol whose contract
changed in Step 2, list its real callers:

```bash
shp graph <Symbol> --kind calls
```

This yields the `calls` hyperedges incident to the symbol — the callers that depend on
it. Keep only callers that are NOT themselves in the diff (callers inside the diff are
Step 1's job; trust it and do not double-report). If this command shows no external
callers, there is simply no caller-impact bug to add for this symbol — that is the
expected case, not a gap. Do not broaden into general cross-object pattern hunting beyond
the callers this command returns.

For each external caller, ask whether the Step-2 contract delta breaks it:

- **Now-wrong assumption** — the caller passes/handles arguments or reads the return per
  the OLD signature/shape (wrong arg position, missing new required arg, treats a now-
  nullable return as always-present, assumes the old units/meaning).
- **Unhandled new outcome** — the callee now throws/raises/returns an error or sentinel the
  caller does not catch or check, so the error escapes or a bad value flows downstream.
- **Dropped effect / broken invariant** — the callee no longer performs a write/lock/
  validation/audit the caller relied on (or now performs one the caller does not coordinate
  with), violating an invariant or ordering the model declares at the caller.
- **Cross-component coordination** — a shared resource the caller mutates is now also
  mutated by the changed callee without the `coordinated_call`/ownership coordination the
  model implies.

Use `shp explain <Caller>` to confirm what the caller actually relies on before asserting
breakage. Add one `{path, line, body}` candidate per broken caller, ON TOP OF the Step-1
local findings — never replace or suppress a local finding. Anchor each on the caller's
file and line, and name the changed contract AND the precise breakage.

**Citation gate (admission rule for this step ONLY):** admit a caller-impact candidate
only when the model shows a concrete dependency on the changed contract AND you can name
the precise breakage. If the relation is ambiguous or you cannot cite the dependency from
`shp`, do NOT add it — an unfounded cross-object claim is a false positive, and model
silence is not a citation. This gate decides ADMISSION of new caller-impact candidates; it
must NEVER remove a Step-1 local candidate.

Secondary, same-mechanism use only: if a Step-1 local candidate hinges on an out-of-diff
contract (the changed code calls a function whose declared effects/return in the model
contradict its assumption), use `shp explain <Callee>` to confirm and keep that candidate.
This is not license for open-ended cross-object scanning.

## Step 4 — The single suppression pass (the ONLY drop authority; inverted burden)

Walk every candidate from Steps 1 and 3 exactly once. The DEFAULT action is KEEP — keeping
requires no justification at all. You may drop a candidate ONLY by citing ONE concrete,
evidence-backed reason from this CLOSED list (no other reason is legal):

- **Provably handled** — visible code or the Shape model shows the concern is already
  guarded (the null is checked upstream; the contract/invariant from `shp explain` /
  `shp obligations` actually permits this; the effect is declared and satisfied).
- **Provably unreachable** — the path cannot execute (guarded by a condition, dead branch,
  type makes the value impossible), shown by visible code or the call graph.
- **Misread diff** — re-reading the hunk shows the candidate rests on a misreading (wrong
  line, wrong variable, the operator is actually correct).
- **Invalid caller citation** — for a Step-3 caller-impact candidate ONLY: re-checking the
  cited dependency shows the caller never relied on the changed behavior (it is already in
  the diff and updated, it does not pass/read the changed parameter/return, or the model
  relation is not what you assumed). An un-validated citation is a guess. (This reason can
  NEVER be applied to a Step-1 local candidate — local findings stand on the diff alone.)
- **Pure duplicate** — the same bug at the same location is already kept (merge; keep the
  clearest body and the most precise line).
- **Not a bug class** — pure style/naming/formatting/preference with no behavioral defect.

Rules for this gate, stated to prevent recall collapse:
- If NONE of the reasons applies, you KEEP. Full stop.
- "I'm not fully sure," "this feels speculative," "probably fine," and "low confidence" are
  NOT kill-reasons. On any doubt you KEEP.
- Never drop a candidate for lacking supporting evidence — this gate asks whether there is a
  cited reason AGAINST the candidate, not whether there is evidence FOR it.
- Never apply a category/severity filter (e.g. "skip pure functions," "only high-severity,"
  "narrow to callers only"). Blanket suppression has empirically destroyed recall; this
  closed-list gate exists precisely to forbid it.

## Step 5 — Assemble and emit

Union the Step-4 survivors (local + caller-impact). Merge exact duplicates (keep the
clearest body, prefer the most precise line). Keep one concrete bug per comment. Each
`body` states the bug AND its mechanism so a reader could check it:
- **Local bug** — name the exact failing token/value/line and the input/state under which
  it breaks (e.g., "when `items` is empty, `items[0]` on line 142 is `undefined` and `.id`
  throws").
- **Caller-impact bug** — name the changed contract and the broken caller (e.g., "`fetchUser`
  now returns `None` on miss; out-of-diff caller `renderProfile` dereferences it unchecked,
  per `shp graph fetchUser --kind calls`"). Anchor on the caller's line.

No style nitpicks, no summaries, no praise, no general advice. Do NOT include confidence
values, class labels, or gating reasoning in `body`.

Write the final review to `./review.json`:

```json
{"comments": [{"path": "relative/file.ext", "line": 42, "body": "one concrete issue"}]}
```

`path` is repo-relative; `line` is the line where the bug must be fixed (for a broken
caller, the caller's line). If after the suppression gate there are no real bugs, write
exactly `{"comments": []}`. Do not lower any bar to fill the file.
