---
name: v14-recall-precision-synthesis
description: Phase 2 (scored). Synthesis variant — keep v13's recall-first skeleton (exhaustive local pass that prunes nothing, then ONE closed-list named-reason drop gate that keeps on doubt) and bolt on three precision devices that NEVER delete a real bug: graded confidence used only to order work and set body strength, a mandatory mechanism/Shape-fact citation written into every emitted body, and a class-split admission gate that requires each cross-object addition to cite a concrete Shape fact. Shape model mounted at ./shape, shp CLI on PATH, used on every PR. Emits review.json.
---

# Shape Review (Phase 2, scored) — recall-first skeleton + non-destructive precision (graded confidence + closed-list drop + mechanism citation + cross-object citation gate)

Maximize F1 against the human golden comments. Pooled F1 = 2·TP/(C+G): the golden count
G is fixed, so you win by (a) not missing the bugs a human flagged and (b) not emitting the
extras a human would not flag. Those two pull against each other, so this skill splits them
in TIME and gives each its own dedicated mechanism — and, crucially, makes sure the
precision machinery can NEVER delete a real bug.

- **RECALL is bought once, up front, by casting wide and pruning NOTHING** (Step 1). Most
  golden bugs are LOCAL, so the exhaustive local diff pass is the foundation and is never
  shortchanged or silently trimmed.
- **CROSS-OBJECT recall the diff cannot show is added from the Shape model** (Step 3), and
  each such addition must cite a concrete Shape fact (class-split: local findings ride the
  recall foundation untouched; cross-object findings must be grounded to be admitted).
- **PRECISION is bought by predicting human SALIENCE** through three cooperating devices,
  none of which deletes a real bug:
  1. A graded internal confidence per candidate (Step 4) that orders the work and sets how
     strongly each body is written — confidence is a RANKING/PHRASING signal, **not** a drop
     signal.
  2. **The single suppression authority** (Step 5): one pass whose only legal action is to
     drop a candidate matching a named reason from a CLOSED kill-list. Absence of a
     kill-reason is a KEEP. Low confidence is NOT a kill-reason.
  3. A **mandatory mechanism citation written INTO every emitted body** (Step 6): a finding
     ships only if its body literally names the failing mechanism (exact wrong line/value-
     flow, or the violated Shape construct). Vague/speculative phrasing fails to ship because
     it cannot be written mechanically — not because a drop pass removed it.

The Shape model is a whole-codebase graph mounted at `./shape` (a real dir) with `shp` on
PATH. **Use it on EVERY PR — small diffs included; it is never skipped or suppressed.** Obey
the inlined `shape-lang/SKILL.md` and `cli-workflows.md`. Use ONLY real `shp` commands. Work
the steps in order, then write `./review.json`.

## Step 1 — Exhaustive local recall pass (cast wide; prune NOTHING here)

Review the diff as a rigorous diff-only reviewer and list EVERY plausible real defect in the
changed code. This is purely a recall step: be deliberately generous. If a line could be a
real bug, write it down. Do **not** prune, do **not** second-guess, do **not** weigh
confidence, do **not** think about precision or salience yet — all of that happens later
(Steps 4–6). Tempting yourself to drop a candidate here, before the gate, is the failure mode
that collapses recall; do not do it.

Sweep at minimum for:
- Logic errors, inverted/off-by-one conditionals, wrong operator, wrong variable, swapped args.
- Null/None/undefined/zero-value dereference; missing existence or bounds checks.
- Error handling: swallowed errors, unchecked returns, wrong error path, missing rollback.
- Resource lifecycle: leaks, unclosed handles, double-free/double-close, missing cleanup.
- Concurrency: races, missing await/lock, check-then-act, ordering assumptions.
- Security: injection, missing authz/authn, unvalidated input, path traversal/SSRF, leaked secrets.
- Incorrect API/library usage given the function's own signature and the visible call.
- State/data bugs: mutation of shared/aliased data, stale cache, wrong default, bad coercion.
- Behavior regressions: the changed line alters observable behavior in a way that breaks a caller or edge case.

Record each candidate as `{path, line, body, class:"local", mechanism:"…"}`, where `body`
states the bug AND why it is wrong, and `mechanism` is a one-line note of the exact thing
that goes wrong (the token/line/value-flow) — you will need that note in Step 6. Keep
candidates even at moderate or low confidence. This list is your recall floor and must be as
complete as a dedicated reviewer's. Nothing is removed in this step.

## Step 2 — Load Shape context (always run; informs Steps 3, 4, and 5)

Orient in the model so you can (a) find cross-object bugs in Step 3, (b) raise confidence on
grounded findings in Step 4, and (c) supply "provably handled / unreachable" kill-reasons in
Step 5:

1. `shp graph --stats` — one-shot overview (vertices, hyperedges, arity, isolated vertices).
2. For each symbol changed in the diff: `shp explain <Symbol>` (derived facts, declared
   effects, return/ownership contract, rationale/memory, source anchor) and
   `shp graph <Symbol> --kind calls` (callers and callees — callers outside the diff are
   where broken-contract bugs hide).
3. `shp graph <Symbol>` — all relations incident to the symbol (`provides`, `callbacks`,
   `coordinated_call`, ownership) when a relation is in question.
4. `shp check` — surface model-level diagnostics relevant to the changed area.
5. When a write/delete/permission/ownership/atomicity effect is involved: `shp obligations`
   and `shp memory` for guards and invariants on the changed targets, and
   `shp analyze --shape-files <model.shape> <changed-source-file>` to compare the diff's
   actual effects against the declared contract.

Use ONLY these real commands. Do not invent commands. Do not treat analyzer hints as ground
truth — read the cited fact before relying on it.

## Step 3 — Shape augment, class-split + citation-gated (cross-object recall)

Using the Step-2 context, add real bugs that require understanding BEYOND the diff. These are
`class:"cross-object"` and face a stricter admission bar than local findings, by design:
local findings already rode the full recall foundation in Step 1; the cross-object class is
where precision is bought, so each cross-object candidate must cite a concrete Shape fact.

Look ONLY for bugs the diff cannot show on its own:
- **Dependency-contract misuse** — the diff calls a symbol defined outside the diff against
  its declared effects/return/ownership contract (cite the contract from `shp explain`).
- **Violated invariant / owned-resource rule** — the change performs an unaudited write,
  bypasses a permission/ownership rule, or breaks an atomicity/coordination contract that
  `shp explain` / `shp memory` / `shp obligations` declares on the target.
- **Broken caller** — the change alters a contract such that callers not in the diff (per
  `shp graph <Symbol> --kind calls`) now misbehave.
- **Cross-component race / ordering** — a shared resource is mutated from multiple components
  without the coordination the model implies (`coordinated_call`).
- **Guarded-change violation** — the diff edits a function/property under a Memory Guard or
  open obligation without the required reevaluation (`shp obligations`, `shp memory`).

**CROSS-OBJECT CITATION GATE (admission rule, applies to this class ONLY):** admit a
cross-object candidate ONLY if you can name the exact model fact it violates and where it came
from — the specific relation/effect/invariant/memory/source anchor, PLUS the `shp` command and
symbol that produced it. If you cannot cite a concrete Shape fact, do NOT add the cross-object
candidate — model silence is not a citation. This gate decides ADMISSION of new cross-object
candidates; it must NEVER remove a Step-1 `local` candidate. If the model reveals nothing
cross-object, add nothing — that is fine.

Record each admitted cross-object candidate as
`{path, line, body, class:"cross-object", mechanism:"<named Shape construct + shp command>"}`.
Do not duplicate a Step-1 candidate; if the diff and the model surface the same bug, keep one
(prefer the one with the precise line and the model citation).

## Step 4 — Graded confidence (ordering + body strength ONLY; never a drop)

Assign every candidate (local AND cross-object) an internal confidence in [0.0, 1.0], anchored
to these evidence tiers. **This number orders your work and calibrates how strongly each body
is phrased. It is NOT a threshold and NOT a drop reason — nothing is removed in this step. A
low score never deletes a candidate; only the Step-5 closed-list gate can drop.**

- **0.90–1.00** — Mechanical/provable from the diff alone: the changed code is wrong on its
  face (off-by-one, inverted condition, null deref on a value the diff shows can be null,
  leaked/unclosed resource, wrong variable, swapped args) and you can point to the exact
  breaking line.
- **0.75–0.89** — Strong: a concrete defect resting on one clear, verifiable fact — a Shape
  contract/invariant/caller edge you actually saw via `shp`, or a changed-behavior regression
  with a nameable triggering input.
- **0.55–0.74** — Moderate: a likely bug whose triggering path/precondition you can describe
  but not pin to a specific line or a cited model fact.
- **0.30–0.54** — Weak: depends on assumptions about code you cannot see, or "could be a
  problem if…" with no concrete trigger.
- **0.00–0.29** — Speculative/architectural: a design opinion or refactor with no concrete
  failing input and no cited model fact.

Scoring rules (these protect recall — apply them honestly):
- **Evidence floors, never random.** If you can name the exact wrong line, it is ≥0.90 — do
  not talk a solid local bug down out of caution.
- **Shape evidence is RAISE-only.** A cited contract/invariant/caller edge pushes a candidate
  UP a tier. The ABSENCE of a Shape fact NEVER lowers a local candidate — most bugs are local
  and invisible to the model.
- **Score on positive evidence FOR the bug.** Lower a score only when you have a concrete
  reason the bug is weak, never merely because you feel unsure. When torn between two adjacent
  tiers, pick the HIGHER.

How the score is USED (and only how):
- It ORDERS the Step-5 walk: process highest-confidence candidates first so the strongest
  findings anchor the review.
- It SETS BODY STRENGTH in Step 6: high-confidence bodies assert the failure directly;
  lower-confidence-but-surviving bodies still state a concrete mechanism (they survived the
  gate, so they ship), without hedging language. Confidence is NEVER written into `body`.
- It does NOTHING else. It does not gate, threshold, or drop. The reason: a technically-real
  low-salience bug and a flat-out false positive can both look "low confidence," but only the
  closed-list gate (Step 5) can tell them apart, and on doubt we KEEP.

## Step 5 — The single suppression pass (the ONLY drop authority; inverted burden)

Walk every candidate exactly once, highest confidence first. The DEFAULT action is KEEP —
keeping requires no justification and no "evidence for keeping." You may drop a candidate ONLY
by citing ONE concrete, evidence-backed reason from this CLOSED list (no other reason is
legal):

- **Provably handled** — visible code or the Shape model shows the concern is already guarded
  (the null is checked upstream; the contract/invariant from `shp explain` / `shp obligations`
  actually permits this; the effect is declared and satisfied).
- **Provably unreachable** — the path cannot execute (guarded by a condition, dead branch,
  type makes the value impossible), shown by visible code or the call graph.
- **Misread diff** — re-reading the hunk shows the candidate rests on a misreading (wrong
  line, wrong variable, the operator is actually correct).
- **Invalid cross-object citation** — for a `cross-object` candidate ONLY: re-checking the
  cited Shape fact shows it does not actually prove a violation (the contract permits the
  behavior, the relation is not what you assumed, or the invariant does not apply on this
  path). An un-validated citation is a guess. (This reason can NEVER be applied to a `local`
  candidate — local findings stand on the diff alone.)
- **Pure duplicate** — the same bug at the same location is already kept (merge; keep the body
  with the clearest mechanism and the higher confidence).
- **Not a bug class** — pure style/naming/formatting/preference with no behavioral defect.

Rules for this gate, stated to prevent recall collapse:
- If NONE of the reasons applies, you KEEP. Full stop.
- "I'm not fully sure," "this feels speculative," "probably fine," and "low confidence" are
  **NOT** kill-reasons. On any doubt you KEEP.
- Never drop a candidate for lacking supporting evidence — this gate asks whether there is a
  cited reason AGAINST the candidate, not whether there is evidence FOR it.
- Never apply a category/severity filter (e.g. "skip pure functions," "only high-severity,"
  "narrow to callers"). Blanket suppression has empirically destroyed recall; this closed-list
  gate exists precisely to forbid it.

## Step 6 — Mechanism-citation gate at the output boundary, then assemble

This is the final precision device and the LAST point at which a candidate fails to ship. It
removes VAGUENESS, never evidence: a survivor ships only if its `body` literally states its
mechanism, written so a reader could check it. A finding whose mechanism you cannot put in
writing is not understood well enough to ship — leave it out (this is a phrasing/understanding
bar, not the drop authority of Step 5).

Every emitted `body` MUST contain at least one of these two citations:
1. **Concrete value/line failure (typical for LOCAL bugs):** name the exact token/line that
   breaks and the input/state under which it breaks — e.g., "when `items` is empty, `items[0]`
   on line 142 is `undefined` and `.id` throws"; "`offset` is a byte index but `slice(offset)`
   on line 88 expects a char index, so multibyte input over-skips." "This looks wrong / could
   be a problem / might not handle X" is NOT a mechanism.
2. **Named Shape construct (required for CROSS-OBJECT bugs):** name the specific
   contract/invariant/effect/relation/memory the change violates, exactly as it appears in the
   model, plus the `shp` command that revealed it — e.g., "violates the `audited` effect
   declared on `AuditStore.purge` (`shp explain AuditStore.purge`): the new call path performs
   the delete without the required audit write"; "breaks Memory Guard
   `DecisionRefactorConstraint` on `Gateway.derivePolicyDecision` (`shp obligations`): the diff
   edits the guarded function with no reevaluation."

Rule of thumb: if you can point at neither an exact failing line/value NOR a named model
construct, the body fails the gate — do not emit it. (In practice a Step-5 survivor that
genuinely cannot be stated mechanically is rare; a clean local bug always has a line/value to
name.) Phrase each surviving body at the strength its Step-4 confidence warrants, but always
concretely and never with hedging filler. Do NOT include confidence numbers or any gating
reasoning in `body`.

Then assemble: union the surviving local findings with the surviving cross-object findings,
merge exact duplicates (keep the clearest-mechanism body), one concrete bug per comment. Drop
the `class`, `mechanism`, and confidence working fields from the output. No style nitpicks, no
summaries, no praise, no general advice.

## Output contract (required)

Write the final review to `./review.json`:

```json
{"comments": [{"path": "relative/file.ext", "line": 42, "body": "one concrete issue"}]}
```

- One concrete bug per comment. `path` is repo-relative; `line` is the relevant line where the
  bug must be fixed.
- `body` states the bug AND its mechanism: the exact failing value/line, OR the named Shape
  contract/invariant/effect/relation/memory it violates (with the `shp` command that revealed
  it). No `class`/confidence/working notes in the body.
- No style nitpicks, no summaries, no praise.
- If after the suppression gate and the mechanism-citation gate there are no real bugs, write
  exactly `{"comments": []}` — an empty review is correct when nothing survives. Do not lower
  any bar to fill the file.
