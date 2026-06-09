---
name: v16-invariant-anchored
description: Phase 2 (scored). Anchor BOTH halves of F1 on the ./shape model's AUTHORED invariants/contracts/effects/guards: exhaustive local recall first (prune nothing), then build an invariant register for the changed symbols, ADD cross-object bugs that violate a named register entry or break a real out-of-diff caller (each citing the exact Shape fact), and at the single suppression gate KEEP every invariant-touching candidate unconditionally while everything else survives unless it matches one closed-list named drop reason (keep on doubt). Invariant-touching bugs are exactly the ones humans flag; the local pass protects the local-bug floor. Shape is used on every PR, even tiny diffs. Emits review.json.
---

# Shape Review (Phase 2, scored) — invariant-anchored recall + precision

Maximize F1 against the human golden comments. Two facts drive everything below:

1. **The target is human salience, not technical truth.** Pooled F1 = 2·TP/(C+G); the
   golden set is what a human reviewer actually flagged. A technically-real but
   low-salience bug the human ignored scores as a FALSE POSITIVE. So precision means
   predicting salience: severe, behavior-breaking, non-obvious, or **violating a real
   invariant/contract**. That last clause is the lever this skill pulls.
2. **Most real bugs are LOCAL.** The exhaustive local diff review is the recall
   foundation and is never shortchanged. Shape is purely ADDITIVE on top of it and is
   the authority that tells us which candidates are salient.

The unifying mechanism: **authored Shape invariants are the anchor for BOTH recall and
precision.** Recall — a candidate that violates a specific named invariant/contract/effect,
or breaks a real out-of-diff caller, is a bug worth adding even when the diff alone could
not show it. Precision — a candidate that violates or is governed by an authored invariant
is high-salience and is KEPT unconditionally; every other candidate survives unless it
matches the closed-list drop gate. Anchoring on what the codebase's authors chose to write
down as an invariant is exactly how you predict what a human reviewer chose to flag.

The whole-codebase Shape model is mounted at `./shape` (a real directory) with `shp` on
PATH. **Use it on EVERY PR, including tiny diffs** — even a one-line change can violate an
authored invariant or break an out-of-diff caller, and that is precisely the salient class.
Never skip, suppress, or summarize-away the model. Obey the inlined `shape-lang/SKILL.md`
and `cli-workflows.md`. Use ONLY these real commands:

```
shp graph [--stats] [SYMBOL] [--kind calls]
shp explain SYMBOL
shp check
shp analyze [--shape-files <model.shape> <source-file>]
shp obligations
shp memory
```

Do not invent commands. Do not treat an analyzer hint as ground truth — confirm it against
the diff and the cited fact. Work the steps in order, in one integrated pass, then write
`./review.json`.

## Step 1 — Exhaustive local recall pass (the floor; prune NOTHING here)

Before touching Shape, review the diff exactly as a rigorous diff-only reviewer would and
write down EVERY plausible local defect in the changed lines. This is a pure recall step:
be deliberately generous. If a line could be a real bug, record it. Do NOT prune, do NOT
weigh confidence, do NOT think about precision or salience yet — all suppression happens
later, once, in Step 4.

Sweep at minimum for:

- Logic errors, inverted/off-by-one conditionals, wrong operator, wrong variable.
- Null/None/undefined/zero-value dereference; missing existence or bounds checks.
- Error handling: swallowed errors, unchecked returns, wrong error path, missing rollback.
- Resource lifecycle: leaks, unclosed handles, double-free/double-close, missing cleanup.
- Concurrency: races, missing await/lock, check-then-act, ordering assumptions.
- Security: injection, missing authz/authn, unvalidated input, path traversal/SSRF, secrets.
- Incorrect API/library usage given the function's own signature and the visible call.
- State/data bugs: mutation of shared/aliased data, stale cache, wrong default, coercion.

Record each candidate as `{path, line, body}` where `body` states the bug AND why it is
wrong, naming the exact failing token/value/line. Keep candidates even at moderate or low
confidence — this list is your recall floor and must be as complete as a dedicated
reviewer's. Most real bugs live here. Nothing in later steps may silently delete a Step-1
candidate except the closed-list gate in Step 4.

## Step 2 — Build the invariant register (always run; this is the anchor)

Orient in the model, then pull the **authored invariants, contracts, and effects** that
govern the symbols the diff changed. This is the heart of the skill — do it for every PR,
even small ones.

1. `shp graph --stats` — one-shot overview (vertices, hyperedges, arity, isolated vertices).
2. From the diff, list every changed/added/removed symbol (functions, methods, components,
   resources) plus every symbol the diff *calls into* or *is called by*. This is your
   worklist.
3. For each changed symbol on the worklist:
   - `shp explain <Symbol>` — its derived facts: declared effects, return/ownership
     contract, preconditions, rationale, memory, source anchor. **This is where authored
     invariants and contracts surface.** Read it before claiming anything.
   - `shp graph <Symbol> --kind calls` — incidence: who it calls and who calls it. The
     out-of-diff callers are where broken-contract bugs hide (Step 3).
   - `shp graph <Symbol>` — all relations incident to the symbol (`provides`, `callbacks`,
     `coordinated_call`, ownership) when the change touches cross-component behavior.
4. `shp obligations` and `shp memory` — surface the **authored invariants / Memory Guards /
   open obligations** that protect the changed targets (permission/ownership rules,
   atomicity, audited writes, required reevaluation, required call ordering). Note any whose
   guarded symbol appears on your worklist.
5. `shp check` — model-level diagnostics relevant to the changed area.
6. `shp analyze --shape-files <model.shape> <changed-source-file>` — when a change plausibly
   alters effects, compare the diff's actual effects against the declared contract.

Build an **invariant register**: a short list of the specific authored facts that govern the
changed symbols — each entry = `{the named invariant/contract/effect/guard, the symbol it
governs, the shp command that produced it}`. This register is used twice: as the source of
Step-3 additions, and as the Tier-A keep-list in Step 4. If a changed symbol has no presence
in the model, it simply contributes nothing to the register — that is fine; Step 1 already
covered its local behavior. Do not fabricate an invariant the model did not actually emit;
model silence is not an invariant.

## Step 3 — Recall up: ADD cross-object bugs that violate a register entry or break a caller

Using the invariant register and the call edges from Step 2, add real bugs the diff alone
cannot show. Each addition MUST cite a specific authored Shape fact — the exact
invariant/contract/effect/relation/guard and the `shp` command and symbol that produced it.
Look for:

- **Violated invariant / owned-resource rule** — the change performs an unaudited write,
  bypasses a permission/ownership rule, breaks an atomicity or ordering guarantee, or edits a
  symbol under a Memory Guard / open obligation without the required reevaluation — against a
  specific entry in your invariant register (`shp explain` / `shp obligations` / `shp memory`).
- **Dependency-contract misuse** — the diff calls a function defined OUTSIDE the diff in a
  way that violates that function's declared effects/return/precondition contract
  (`shp explain <Callee>`).
- **Broken caller** — the change alters a symbol's contract (signature, return shape,
  nullability, error behavior, dropped/added effect, changed invariant) such that callers
  NOT in the diff now misbehave. Enumerate them with `shp graph <Symbol> --kind calls`, keep
  only callers outside the diff, confirm the dependency with `shp explain <Caller>`, anchor
  the comment on the caller's file/line.
- **Cross-component race / ordering** — a shared resource is mutated from multiple components
  without the `coordinated_call`/coordination the model declares.

Add each as a `{path, line, body}` candidate whose body NAMES the violated authored fact and
the `shp` command that revealed it. **Citation gate for this step (hard):** admit a
cross-object finding ONLY if you can name the exact model fact it violates and where it came
from. If you cannot cite a concrete authored fact, do NOT emit the cross-object guess — an
un-citable cross-object claim is a false positive. This gate applies to Step-3 additions
ONLY; it must NEVER remove a Step-1 local candidate. If the model reveals nothing
cross-object, add nothing — that is the expected case, not a gap.

Do not let this step tempt you back into Step 1 to silently drop a local candidate, and do
not duplicate a Step-1 candidate.

## Step 4 — Precision up: the single suppression gate (invariant-anchored keep + closed-list drop)

Walk every candidate from Steps 1 and 3 exactly once. This is the ONLY place anything is
removed, and it has exactly two tiers.

**Tier A — anchored KEEP (unconditional).** If a candidate **truly violates or is governed
by an authored invariant/contract/effect/guard in your Step-2 register** — i.e. it touches a
fact the codebase's authors chose to write down — it is high-salience. KEEP it, no questions
asked. This is the precision half of the anchor: invariant-touching bugs are the ones humans
flag. (A Step-3 addition that passed the Step-3 citation gate is by construction anchored and
lands here.) The one prerequisite for Tier A is that the violation is real: if, on the spot,
you can see the cited invariant actually PERMITS the behavior on this path, the candidate
does not violate it and it is not Tier-A — route it to Tier B, where the "provably handled"
or "invalid cross-object citation" reason will drop it. Tier A force-keeps real violations,
never an invariant you only imagined was breached.

**Tier B — everything else faces the closed-list drop gate.** For a candidate NOT anchored
to an authored invariant, the DEFAULT action is still KEEP — keeping requires no
justification. You may drop it ONLY by citing ONE concrete reason from this CLOSED list (no
other reason is legal):

- **Provably handled** — visible code or the model shows the concern is already guarded (the
  null is checked upstream; the cited contract/invariant actually permits this; the effect is
  declared and satisfied).
- **Provably unreachable** — the path cannot execute (guarded by a condition, dead branch, a
  type makes the value impossible), shown by visible code or the call graph.
- **Misread diff** — re-reading the hunk shows the candidate rests on a misreading (wrong
  line, wrong variable, the operator is actually correct).
- **Invalid cross-object citation** — a Step-3 addition whose cited fact, on re-check, does
  not actually prove a violation (the contract permits the behavior, the relation isn't what
  you assumed, the invariant doesn't apply on this path). An un-validated citation is a guess;
  drop it. (Applies to Step-3 additions only — never to a Step-1 local candidate.)
- **Pure duplicate** — the same bug at the same location already appears (merge; keep the
  clearest body and the most precise line).
- **Not a bug class** — pure style/naming/formatting/preference with no behavioral defect.

Rules for this gate (stated to prevent recall collapse):

- If NONE of the closed-list reasons applies, you KEEP. Full stop.
- "I'm not fully sure," "this feels speculative," "probably fine," and "low confidence" are
  NOT drop reasons. On any doubt you KEEP.
- Never drop a candidate merely for lacking supporting evidence FOR the bug — this gate asks
  whether there is a cited reason AGAINST it, not whether there is evidence for it. (Exception:
  an un-citable cross-object claim was already declined at the Step-3 citation gate and never
  reached here.)
- Never apply a category/blanket filter ("skip pure functions," "only high-severity," "drop
  all the extras"). Blanket suppression has empirically destroyed recall; this closed list is
  the only suppression authority precisely to forbid it.
- A solid local bug from Step 1 — exact wrong line you can point to — is never dropped unless
  it matches "provably handled," "provably unreachable," "misread diff," "pure duplicate," or
  "not a bug class."

## Step 5 — Assemble and emit

Union the Tier-A keeps with the Tier-B survivors. Merge exact duplicates (keep the clearest
body, prefer the most precise line). Keep one concrete bug per comment. Each `body` states
the bug AND why it is wrong; when the model revealed it, the body MUST name the violated
authored invariant/contract/effect/relation/guard and the `shp` command that revealed it
(e.g., "violates effect `HardDelete` declared complete on `AuditStore.purge`
(`shp explain AuditStore.purge`): the new path deletes without the required audit write";
or "`fetchUser` now returns `None` on miss; out-of-diff caller `renderProfile` dereferences
it unchecked, per `shp graph fetchUser --kind calls`"). No style nitpicks, no summaries, no
praise, no general advice.

Write the final review to `./review.json`:

```json
{"comments": [{"path": "relative/file.ext", "line": 42, "body": "one concrete issue"}]}
```

`path` is repo-relative; `line` is the line where the bug must be fixed (for a broken caller,
the caller's line). If after the suppression gate there are no real bugs, write exactly
`{"comments": []}`. Do not lower any bar to fill the file.
