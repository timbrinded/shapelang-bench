---
name: v8-crossobject-grounding-max
description: Phase 2 (scored). Split findings into two classes with two different admission bars - LOCAL findings (visible in the diff) ride the full recall foundation untouched, while CROSS-OBJECT findings (things the diff cannot show) are admitted ONLY when they cite a specific Shape model fact (relation/effect/invariant/source anchor) they violate; un-citable cross-object guesses are dropped, the local review is never gated. Emits review.json.
---

# Shape Review (Phase 2, scored) — class-split cross-object grounding gate

Maximize F1 against human golden comments. The distinctive mechanism of THIS variant is an
**asymmetric, class-split admission rule**: a finding is either `local` (the diff alone shows
it) or `cross-object` (only the whole-codebase model shows it), and the two classes face two
DIFFERENT bars. Local findings ride the recall foundation and are kept liberally — the
citation gate NEVER touches them. Cross-object findings are admitted ONLY when they cite a
specific fact from the Shape model; an un-citable cross-object claim is dropped. This is not a
uniform output-boundary citation (that gates every comment); the gate here is applied to ONE
class only, by design, so local recall is structurally protected while the additions are
where precision is bought.

Do everything in ONE pass, in this order. The Shape model is a whole-codebase graph mounted
at `./shape` (a real dir) with `shp` on PATH — use it on EVERY PR. Obey the inlined
`shape-lang/SKILL.md` and `cli-workflows.md`. Use ONLY real `shp` commands. Work the steps in
order, then write `./review.json`.

## Step 1 — Thorough diff-only review FIRST (recall foundation; never shortchange)

Before touching Shape, review the diff exactly as a rigorous diff-only reviewer would and
record EVERY real defect visible in the changed code: logic errors, null/None/undefined,
off-by-one, wrong conditionals/operators, error handling, concurrency, resource leaks,
injection/auth/security, incorrect API usage, regressions, broken edge cases. Most real bugs
are local — this is the foundation and must be as complete as a dedicated reviewer's. Finish
it fully before spending any effort on the model. Mark each finding `class: local`. Do NOT
gate local findings on the model; they stand on the diff alone and the Step 3 citation gate
will not apply to them.

## Step 2 — Build the changed-symbol map (orient the model)

1. List the changed files; write them to `changed.txt` if helpful.
2. `shp graph --stats` for a one-shot overview (vertices, hyperedges, isolated vertices).
3. From the diff, list every changed/added/removed symbol (functions, components, resources)
   and every symbol the diff *calls into* or *is called by*.

This map is the worklist for Step 3. If a changed symbol has no presence in the model, it
simply yields no cross-object findings — that is fine; the local review already covered it.

## Step 3 — Cross-object grounding pass (the Shape edge; citation-gated)

For each changed symbol in the map, pull its model neighborhood and READ it before claiming
anything:

- `shp explain <Symbol>` — derived facts: declared effects, return/ownership contract,
  rationale, memory, source anchor.
- `shp graph <Symbol> --kind calls` — incidence: who it calls and who calls it (callers
  outside the diff are where broken-contract bugs hide).
- `shp graph <Symbol>` — all relations incident to the symbol (`provides`, `callbacks`,
  `coordinated_call`, ownership).
- When a write/delete/permission/ownership effect is involved, `shp memory` and
  `shp obligations` to surface invariants/guards on the target, and
  `shp analyze --shape-files <model.shape> <changed-source-file>` to compare the diff's
  actual effects against the declared contract.

Look ONLY for bugs the diff cannot show on its own:

- **Dependency-contract misuse** — the diff calls a symbol (defined outside the diff) against
  its declared effects/return/ownership contract from `shp explain`.
- **Broken caller** — the diff changes a symbol's contract in a way that breaks a caller not
  in the diff, per `shp graph <Symbol> --kind calls`.
- **Violated invariant / owned-resource rule** — the change performs an unaudited write,
  bypasses a permission/ownership rule, or breaks an atomicity/coordination contract that
  `shp explain` / `shp memory` / `shp obligations` declares on the target resource.
- **Cross-component race / ordering** — a shared resource is mutated from multiple components
  without the `coordinated_call`/coordination the model implies.

CITATION GATE (hard; this IS the strategy). Admit a cross-object finding ONLY if you can name
the exact model fact it violates and where it came from — the specific relation, effect,
invariant/memory, or source anchor, PLUS the `shp` command and symbol that produced it. If you
cannot cite a concrete model fact, DROP the cross-object finding; do not emit a cross-object
guess. Model silence is not a citation. Mark each kept finding `class: cross-object` and carry
its citation into the body. This gate applies to cross-object findings ONLY — it must NEVER
remove a `local` finding from Step 1.

## Step 4 — Verify, CONSERVATIVELY (precision; do not over-drop)

Re-examine all candidates with the model loaded, by class:

- **Local findings:** keep them. Drop one ONLY with hard evidence it is not a real bug (the
  model shows the concern is already handled elsewhere, or the path is provably unreachable).
  When unsure, KEEP — over-dropping local findings destroys recall.
- **Cross-object findings:** re-confirm the citation actually proves a violation. If the cited
  contract in fact permits the behavior, the relation isn't what you assumed, or the invariant
  doesn't apply on this path, DROP it (an un-validated citation is a guess).
- Drop exact duplicates (same bug surfaced by both diff and model → keep one, prefer the
  precise line) and pure style notes. This is the only removal beyond the two rules above —
  never run a blanket "remove false positives" sweep.

## Output contract (required)

Write the final review to `./review.json`:

```json
{"comments": [{"path": "relative/file.ext", "line": 42, "body": "one concrete issue"}]}
```

- One concrete bug per comment. `path` is repo-relative; `line` is where the bug must be fixed.
- `body` states the bug AND why it is wrong. For cross-object findings, name the violated
  contract/invariant/relation the model revealed (e.g., "breaks `Gateway.derivePolicyDecision`'s
  declared `audited` effect — calls `HardDelete` with no AuditEvent, per `shp explain`").
- Drop the `class` labels from the output — they are working notes only.
- No style nitpicks, no summaries, no praise.
- No real bugs → `{"comments": []}`.
