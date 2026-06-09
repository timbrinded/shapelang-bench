---
name: v11-self-consistency
description: Review the SAME diff twice in one call from two independent stances (runtime adversary + Shape-contract-conformance checker), then ensemble-merge — auto-trust any defect both stances surface (agreement is the precision signal), keep all concrete local bugs, and drop only ungrounded single-stance speculation.
---

# Shape Review (Phase 2, scored) — Dual-Stance Self-Consistency

Maximize F1 against human golden comments. The distinctive mechanism of THIS variant:
review the SAME diff TWICE in this one call, from two independent stances, then merge
by SELF-CONSISTENCY. The two stances are different lenses on the same change; when they
INDEPENDENTLY converge on the same defect, that agreement is your strongest precision
signal and cuts the false positives that sink a diff-only review. This is an ensemble,
not a grounding filter and not a confidence threshold — the precision comes from
cross-stance agreement, and single-stance findings are kept or dropped by clear rules.

The whole-codebase Shape model is mounted at `./shape` (a real dir) with `shp` on PATH.
Use it on every PR. Obey the inlined `shape-lang/SKILL.md` and `cli-workflows.md`. Use
ONLY real `shp` commands.

Most real bugs are LOCAL, so Stance A is the recall foundation and must be as complete
as a dedicated diff reviewer's — never shortchange it.

## Step 0 — Load the Shape neighborhood once (shared evidence for both stances)

Run once and keep the output in front of you for BOTH stances — a shared evidence base
is what makes the two stances comparable rather than two random samples:

1. `shp graph --stats` — size up the hypergraph (vertices, hyperedges, isolated
   vertices) so you know what cross-object structure exists.
2. For each symbol the diff adds, changes, or calls: `shp explain <Symbol>` (declared
   effects, return contract, rationale) and `shp graph <Symbol> --kind calls`
   (callers/callees outside the diff).
3. If the diff touches guarded or owned targets: `shp obligations` and `shp memory` to
   see invariants / Memory Guards that constrain the change; finish with `shp check`
   (and `shp analyze --shape-files <file.shape> <changed-source>` when you want
   declared-vs-actual effect hints). Treat analyzer output as a hint, never a verdict.

## Step 1 — Stance A: Runtime adversary (recall foundation; do this FULLY first)

Read the diff as an adversary trying to make the change FAIL at runtime. Independently —
without yet consulting the model's contract view — write down EVERY concrete way it
breaks, with exact path/line: logic errors, off-by-one, inverted/incorrect conditionals,
null/None/undefined and unchecked optionals, bad or missing error handling, exceptions
on edge inputs, concurrency/race conditions, resource leaks, unsafe/incorrect API usage,
security holes, type/serialization mismatches. Complete this pass fully before Stance B.
Record each finding as a candidate: `{path, line, body, stance: A, grounding}`.

## Step 2 — Stance B: Shape-contract-conformance reviewer (independent re-review)

Now re-review the SAME diff from a different question, deliberately set aside Stance A's
list, and ask only: does the change CONFORM to what the Shape model declares? Using the
Step 0 evidence, hunt for what the diff alone cannot show:
- **Dependency-contract misuse** — calls a function defined outside the diff in a way
  inconsistent with its declared effects/return contract (`shp explain`).
- **Violated invariant / Memory Guard** — breaks an owned-resource invariant or
  cross-module contract (unaudited write, permission/ownership rule, atomicity,
  freshness) surfaced by `shp memory` / `shp obligations`.
- **Broken caller** — changes a symbol's contract in a way that breaks callers not in
  the diff (`shp graph <Symbol> --kind calls`).
- **Cross-component race / ordering** — a shared resource mutated from multiple
  components without the coordination the model implies (`coordinated_call`).
Record each as `{path, line, body, stance: B, grounding}`. For Stance B, `grounding`
MUST name the concrete model fact (the contract/invariant/caller and the `shp` command
that revealed it) — an ungrounded Stance B finding does not exist.

## Step 3 — Merge by self-consistency (the precision gate is AGREEMENT)

Take the UNION of Stance A and Stance B candidates and classify each by how many stances
independently surfaced it:

- **AGREED (both stances, same defect, same location) — KEEP unconditionally.** When
  Stance A flags a runtime break that Stance B independently maps to a violated
  contract/invariant/caller (or vice versa), the two lenses corroborate each other.
  This convergence is the variant's core precision signal; never drop an AGREED finding.
  Emit ONE comment, preferring the body that names the violated contract/invariant.
- **A-only — KEEP if it is a concrete, locatable runtime bug with a clear failure
  path** (the normal local-bug bar). Do NOT drop an A-only finding merely because
  Stance B did not also see it — the model simply may not cover that defect, and local
  bugs are the recall foundation. Drop only pure style, summaries, praise, or a claim
  with no concrete failure.
- **B-only — KEEP only if `grounding` cites a specific model fact** (named
  contract/invariant/caller + the `shp` evidence) AND the diff actually contradicts it.
  Drop speculative architectural musings with no cited violation — these ungrounded
  cross-object guesses are the false positives that sink precision.

## Step 4 — Final conservative sweep (don't over-drop)

Re-examine each surviving candidate once. Drop one ONLY with hard evidence it is not a
real bug: the "violated" contract actually permits it, the path is unreachable, or the
model shows the concern is already handled. When unsure, KEEP — over-dropping destroys
recall and was a decisive past failure. Never run a blanket "remove false positives"
sweep; gate per-candidate on the rules above only.

## Output contract (required)

Write the final review to `./review.json`:

```json
{"comments": [{"path": "relative/file.ext", "line": 42, "body": "one concrete issue"}]}
```

One issue per comment; `body` states the bug AND why (name the violated
contract/invariant when the model revealed it). No confidence or stance labels in the
output — they are internal to your gating. No style nitpicks, no summaries, no praise.
No real bugs → `{"comments": []}`.
