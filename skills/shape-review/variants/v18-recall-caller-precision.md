---
name: v18-recall-caller-precision
description: Phase 2 (scored). The full synthesis aimed at being +10 in EVERY repo. v13's recall-first chassis (exhaustive local pass that prunes nothing, then ONE closed-list named-reason drop gate that keeps on doubt) keeps the discourse/local recall. Cross-object recall is NARROWED to v10's caller-impact (enumerate out-of-diff callers of each changed contract via `shp graph <Symbol> --kind calls`, flag the ones the change breaks) — precise grounding instead of broad augmentation that floods false positives on grounding-thin repos like sentry-greptile. Precision for cal.com comes ONLY from a non-destructive output-boundary device: every emitted body must name its concrete failing mechanism, so vague/speculative findings cannot ship — but no candidate is ever dropped for low confidence, preserving recall. Shape mounted at ./shape, shp on PATH, used on every PR. Emits review.json.
---

# Shape Review (Phase 2, scored) — recall-first + caller-impact + mechanism-citation precision

Maximize F1 against the human golden comments. Pooled F1 = 2·TP/(C+G): the golden
count G is fixed, so you win by (a) not missing the bugs a human flagged and (b) not
emitting extras a human would not flag. Those pull against each other, so this skill
splits them in time and — crucially — buys precision with a device that can NEVER
delete a real bug.

Three observations drive the design (each from measured behavior across diverse repos):
- **Recall is bought once, up front, by casting wide and pruning NOTHING** (Step 1).
  Most golden bugs are LOCAL; the exhaustive local pass is the foundation and protects
  recall on local-dominated repos.
- **Cross-object recall is NARROWED to the broken caller** (Step 3). The broken caller —
  a changed contract that silently breaks an out-of-diff caller — is Shape's single
  highest-salience, most-groundable cross-object signal (humans flag contract breaks).
  Broad cross-object hunting floods false positives on repos whose authored model is
  thin, so this skill admits ONLY caller-impact findings, each cited.
- **Precision is bought at the OUTPUT boundary, never by a drop** (Step 5). A finding
  ships only if its body literally names the failing mechanism (the exact wrong
  line/value, or the broken caller + changed contract). Vague/speculative findings fail
  to ship because they cannot be written mechanically — not because a pass removed them.
  A real local bug always has a nameable line, so this never costs recall.

The Shape model is mounted at `./shape` (a real dir) with `shp` on PATH. **Use it on
EVERY PR — small diffs included; it is never skipped or suppressed.** Obey the inlined
`shape-lang/SKILL.md` and `cli-workflows.md`. Use ONLY real `shp` commands. Work the
steps in order, then write `./review.json`.

## Step 1 — Exhaustive local recall pass (cast wide; prune NOTHING here)

Review the diff as a rigorous diff-only reviewer and list EVERY plausible local defect in
the changed code. This is purely a recall step: be deliberately generous. If a line could
be a real bug, write it down — do NOT prune, do NOT second-guess, do NOT weigh confidence,
do NOT think about precision yet. All suppression happens once, later, in Step 4.

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

Record each candidate as `{path, line, body, mechanism}`, where `body` states the bug AND
why it is wrong and `mechanism` is a one-line note of the exact failing token/line/value
(you will need it in Step 5). Keep candidates even at moderate or low confidence — Step 4
is the ONLY place anything is removed. This list is your recall floor and must be as
complete as a dedicated reviewer's.

## Step 2 — Identify the changed contracts (what out-of-diff callers depended on)

Orient once with `shp graph --stats`. Then, from the diff, list the changed **symbols**
(functions/methods/components) and for each decide whether its CONTRACT changed — the
thing a caller relies on. A contract change is any of:

- **Signature** — params added/removed/reordered/retyped, defaults changed, arity changed.
- **Return** — shape/type/nullability changed, a sentinel/None/empty now returned, or the
  units/meaning of the value changed.
- **Errors** — now throws/raises/returns-error where it did not (or stopped doing so).
- **Effect / side effect** — now mutates, writes, locks, or performs I/O — or skips an
  effect it used to perform.
- **Invariant / ordering / state** — changes a pre/postcondition, required call order, or
  an owned-resource invariant the model declares.

Confirm with `shp explain <Symbol>` (declared effects, contracts, evidence); use
`shp analyze --shape-files <model.shape> <source>` when an effect change is in doubt, and
`shp obligations` / `shp memory` when the change touches a guarded/owned resource. If a
symbol's contract did NOT change, it has no caller-impact risk — drop it from this track.
Do not invent contract changes that are not in the diff. Do not treat an analyzer hint as
ground truth — read the cited fact first.

## Step 3 — Caller-impact: the ONLY cross-object recall (narrow + cited)

For every changed symbol whose contract changed in Step 2, list its real callers:

```bash
shp graph <Symbol> --kind calls
```

Keep only callers NOT in the diff (callers inside the diff are Step 1's job). If there are
no external callers, there is no caller-impact bug for this symbol — the expected case, not
a gap. Do NOT broaden into general cross-object pattern hunting beyond the callers this
command returns; that breadth is what floods false positives on thin-model repos.

For each external caller, ask whether the Step-2 contract delta breaks it:
- **Now-wrong assumption** — passes/handles args or reads the return per the OLD
  signature/shape (wrong arg position, missing new required arg, treats a now-nullable
  return as always-present, assumes the old units/meaning).
- **Unhandled new outcome** — the callee now throws/returns an error or sentinel the caller
  does not catch/check, so it escapes or a bad value flows downstream.
- **Dropped effect / broken invariant** — the callee no longer performs a write/lock/
  validation/audit the caller relied on, violating an invariant or ordering at the caller.
- **Cross-component coordination** — a shared resource the caller mutates is now also
  mutated by the changed callee without the `coordinated_call` coordination the model implies.

Use `shp explain <Caller>` to confirm what the caller actually relies on before asserting
breakage. Add one `{path, line, body, mechanism}` candidate per broken caller, ON TOP OF
Step 1 — never replacing a local finding. Anchor on the caller's line; `mechanism` names
the changed contract + the precise breakage.

**Citation gate (admission, this step ONLY):** admit a caller-impact candidate only when
the model shows a concrete dependency on the changed contract AND you can name the precise
breakage. If the relation is ambiguous or you cannot cite the dependency from `shp`, do NOT
add it — an unfounded cross-object claim is a false positive; model silence is not a
citation. This decides ADMISSION of new candidates; it must NEVER remove a Step-1 local
candidate.

## Step 4 — The single suppression pass (the ONLY drop authority; inverted burden)

Walk every candidate from Steps 1 and 3 exactly once. The DEFAULT action is KEEP — keeping
requires no justification. You may drop a candidate ONLY by citing ONE concrete,
evidence-backed reason from this CLOSED list (no other reason is legal):

- **Provably handled** — visible code or the model shows the concern is already guarded
  (the null is checked upstream; the cited contract/invariant actually permits this; the
  effect is declared and satisfied).
- **Provably unreachable** — the path cannot execute (guarded by a condition, dead branch,
  a type makes the value impossible), shown by visible code or the call graph.
- **Misread diff** — re-reading the hunk shows the candidate rests on a misreading (wrong
  line, wrong variable, the operator is actually correct).
- **Invalid caller citation** — for a Step-3 candidate ONLY: re-checking the cited
  dependency shows the caller never relied on the changed behavior. (Never applied to a
  Step-1 local candidate.)
- **Pure duplicate** — the same bug at the same location is already kept (merge; keep the
  clearest body).
- **Not a bug class** — pure style/naming/formatting/preference with no behavioral defect.

Rules (stated to prevent recall collapse):
- If NONE of the reasons applies, you KEEP. Full stop.
- "I'm not fully sure," "this feels speculative," "probably fine," and "low confidence" are
  NOT kill-reasons. On any doubt you KEEP.
- Never drop a candidate for lacking supporting evidence — this gate asks whether there is a
  cited reason AGAINST the candidate, not whether there is evidence FOR it.
- Never apply a category/severity filter ("skip pure functions," "only high-severity").
  Blanket suppression has empirically destroyed recall; this closed list is the only
  suppression authority precisely to forbid it.

## Step 5 — Mechanism-citation gate at the output boundary, then assemble (the precision lever)

This is the final precision device and the LAST point at which a candidate fails to ship.
It removes VAGUENESS, never evidence: a Step-4 survivor ships only if its `body` literally
states its mechanism, written so a reader could check it. A finding whose mechanism you
cannot put in writing is not understood well enough to ship — leave it out. This is a
phrasing/understanding bar, NOT the drop authority of Step 4; in practice a real local bug
always has a concrete line/value to name, so this costs no recall — it only removes the
speculative "this looks wrong / might not handle X" extras that leak precision.

Every emitted `body` MUST contain at least one of:
1. **Concrete value/line failure (typical LOCAL bug):** the exact token/line that breaks and
   the input/state under which it breaks — e.g., "when `items` is empty, `items[0]` on line
   142 is `undefined` and `.id` throws." "This looks wrong / could be a problem" is NOT a
   mechanism.
2. **Caller-impact (CROSS-OBJECT bug):** the changed contract and the broken caller — e.g.,
   "`fetchUser` now returns `None` on miss; out-of-diff caller `renderProfile` dereferences
   it unchecked, per `shp graph fetchUser --kind calls`." Anchor on the caller's line.

Rule of thumb: if you can point at neither an exact failing line/value NOR a broken
caller + changed contract, the body fails the gate — do not emit it.

Then assemble: union the surviving local findings with the surviving caller-impact findings,
merge exact duplicates (keep the clearest-mechanism body), one concrete bug per comment.
Drop the `mechanism` working field from the output. No style nitpicks, no summaries, no
praise, no general advice. Do NOT include confidence values or gating reasoning in `body`.

Write the final review to `./review.json`:

```json
{"comments": [{"path": "relative/file.ext", "line": 42, "body": "one concrete issue"}]}
```

`path` is repo-relative; `line` is the line where the bug must be fixed (for a broken
caller, the caller's line). If after the suppression and mechanism-citation gates there are
no real bugs, write exactly `{"comments": []}`. Do not lower any bar to fill the file.
