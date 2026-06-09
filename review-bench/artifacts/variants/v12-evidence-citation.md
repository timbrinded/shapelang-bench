---
name: v12-evidence-citation
description: Phase 2 (scored). Do a full diff-only review for recall, augment with Shape for cross-object bugs, then enforce precision at the OUTPUT boundary — every emitted comment body must literally cite its failing mechanism (the exact value/line that breaks, or a named Shape contract/invariant/effect plus the shp command that revealed it). Vague-but-true and speculative findings cannot survive the citation; mechanically-stated real bugs pass untouched. No separate drop pass. Emits review.json.
---

# Shape Review (Phase 2, scored) — mechanism-citation gate

Maximize F1 against human golden comments. Precision is the lever (a diff-only reviewer sits
near 50% precision). This variant's precision discipline lives at the **output boundary**, not
in a drop pass: a finding ships only if its comment `body` literally states its **mechanism** —
the exact thing that goes wrong, written down so a reader could check it. You never delete real
bugs to chase precision; you decline to emit findings whose mechanism you cannot write. The
same citation requirement applies uniformly to LOCAL and CROSS-OBJECT findings.

Work in ONE pass, in order. The whole-codebase Shape model is mounted at `./shape` (a real
dir) with `shp` on PATH; use it on every PR. Obey the inlined `shape-lang/SKILL.md` and
`cli-workflows.md`.

## Step 1 — Thorough diff review FIRST (recall; never shortchange this)

Before touching Shape, review the diff exactly as a rigorous diff-only reviewer would and
write down EVERY real defect visible in the changed lines: logic errors, null/None/undefined,
off-by-one, wrong conditionals/operators, error handling, concurrency, resource leaks,
security, incorrect API usage, broken edge cases. Most real bugs are LOCAL — this is the
recall foundation and must be as complete as a dedicated reviewer's. Finish it fully before
spending any effort on the model. Do NOT filter yet; collect candidates with their suspected
mechanism noted.

## Step 2 — Shape augment (recall the diff can't reach)

Now use the model for what the diff cannot show. Run `shp graph --stats` for the overview,
then for each changed symbol run `shp explain <Symbol>` and `shp graph <Symbol> --kind calls`.
Use `shp obligations` and `shp memory` to surface guarded targets the diff touches, and
`shp check` / `shp analyze --shape-files <file> <src>` when an effect mismatch is plausible.
Add real cross-object bugs grounded in the model:

- **Dependency-contract misuse** — the diff calls a function defined outside the diff against
  its declared effects/return contract (wrong effect, ignored failure mode, violated return shape).
- **Violated invariant** — breaks an owned-resource invariant or cross-module contract
  (unaudited write, permission/ownership rule, atomicity, ordering) declared elsewhere in the model.
- **Broken caller** — changes a contract in a way that breaks callers not in the diff
  (per `shp graph <Symbol> --kind calls`).
- **Cross-component race / ordering** — a shared resource is mutated from multiple components
  without the coordination (`coordinated_call`) the model implies.
- **Guarded-change violation** — the diff edits a function/property under a Memory Guard or
  open obligation without the required reevaluation (`shp obligations`, `shp memory`).

For each cross-object candidate, write down the exact model construct (effect/contract/
invariant/relation/memory) and the `shp` command that surfaced it. That note becomes the
citation in Step 4.

## Step 3 — Verify CONSERVATIVELY (precision), then keep every survivor that has a mechanism

Re-examine every candidate from Steps 1–2. Drop a candidate ONLY when you have concrete
evidence it is not a real bug (the "violated" contract actually permits it; the path is
provably unreachable; the model shows the concern is already handled elsewhere). **When
unsure, KEEP it** — do not second-guess a solid local bug; over-dropping destroys recall.
Also drop exact duplicates (same bug at the same place) and pure style/preference notes. This
step removes only proven non-bugs, duplicates, and style — never an evidenced bug.

## Step 4 — Mechanism-citation gate (the precision lever; applied at the output boundary)

This is where precision is enforced, and it is the ONLY additional removal in the pipeline.
Before any survivor may be emitted, you MUST write its mechanism INTO the comment `body`. A
finding whose mechanism you cannot put in writing is not understood well enough to ship — do
not emit it. The gate removes vagueness and speculation, never evidence: every candidate that
CAN be stated mechanically passes, local and cross-object alike.

Every emitted `body` MUST contain at least one of these two citations:

1. **Concrete value/line failure (LOCAL bugs):** name the exact token that breaks and the
   input/state under which it breaks. Examples: "`offset` is a byte index but `slice(offset)`
   on line 88 expects a char index, so multibyte input over-skips"; "when `items` is empty,
   `items[0]` on line 142 is `undefined` and `.id` throws". "This looks wrong / could be a
   problem / might not handle X" is NOT a mechanism — drop it.

2. **Named Shape construct (CROSS-OBJECT bugs):** name the specific contract / invariant /
   effect / relation / memory the change violates, exactly as it appears in the model, plus
   the `shp` command that revealed it. Examples: "violates effect `HardDelete` declared
   complete on `AuditStore.purge` (`shp explain AuditStore.purge`): the new call path performs
   the delete without the audit write the contract requires"; "breaks Memory Guard
   `DecisionRefactorConstraint` on `Gateway.derivePolicyDecision` (`shp obligations`): the diff
   changes the guarded function with no reevaluation". A cross-object claim with NO named model
   construct is unverifiable speculation — drop it.

Rule of thumb: if you can point at neither an exact failing line/value NOR a model symbol by
name, the comment fails the gate — do not emit it. The citation lives in the shipped text, so
the same words that pass the gate are the words the reviewer reads.

## Output contract (required)

Write the final review to `./review.json`:

```json
{"comments": [{"path": "relative/file.ext", "line": 42, "body": "one concrete issue"}]}
```

- One issue per comment. `path` is repo-relative; `line` is where the bug must be fixed.
- `body` states the bug AND its mechanism: the exact failing value/line, OR the named Shape
  contract/invariant/effect/relation/memory it violates (with the `shp` command that revealed it).
- No style nitpicks, no summaries, no praise.
- No real bugs → `{"comments": []}`.
