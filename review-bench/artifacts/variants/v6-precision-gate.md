---
name: v6-precision-gate
description: Phase 2 (scored). Do a full diff-only review for recall, augment with Shape cross-object findings, then assign every candidate a numeric internal confidence (0.0-1.0) anchored to explicit evidence tiers and emit only those at or above a single calibrated bar (0.70) — quantitative thresholding, not a drop pass. Emits review.json.
---

# Shape Review (Phase 2, scored) — internal confidence gating

Maximize F1 against human golden comments. F1 is won on PRECISION: a diff-only
reviewer sits near 50% precision because it emits plausible-but-unprovable guesses.
This variant's mechanism is a NUMBER: every candidate gets an internal confidence
score in [0.0, 1.0], anchored to explicit evidence tiers, and is emitted iff that
score clears one calibrated threshold. The gate is purely quantitative — not a
keyword/category filter, not a yes/no "has a citation" test, not a separate
drop pass. The score is reasoned from the strength of the evidence, never guessed.

The whole-codebase Shape model is mounted at `./shape` (a real dir) with `shp` on
PATH. Use it on every PR — never skip it. Obey the inlined `shape-lang/SKILL.md`
and `cli-workflows.md`. Do everything in one integrated pass; do NOT run a separate
"drop the false positives" pass (that over-drops real bugs). Gating is a single
forward scoring decision per candidate, made the first and only time you see it.

## Step 1 — Thorough diff review FIRST (build the recall base; do not shortchange)

Before touching Shape, review the diff exactly as a rigorous diff-only reviewer
would and write down EVERY plausible real defect as a candidate: logic errors,
null/None/undefined, off-by-one, wrong conditionals/operators, error handling,
concurrency, resource leaks, security, incorrect API usage, regressions in changed
behavior. Most real bugs are LOCAL — this list is the recall foundation and must be
as complete as a dedicated reviewer's. Be generous here; scoring and gating happen
later, so do NOT pre-filter. Capture each candidate with its exact `path` and `line`.

## Step 2 — Shape augment (cross-object candidates the diff can't show)

Now use the model for what the diff cannot reach. Run `shp graph --stats` for the
overview, then for each changed symbol run `shp explain <Symbol>` and
`shp graph <Symbol> --kind calls`; use `shp obligations` and `shp memory` when the
change touches guarded targets, and `shp analyze <source>` when an effect change is
in doubt. Add candidates that need cross-object understanding, each tied to a
specific model fact you observed:

- **Dependency-contract misuse** — calls an out-of-diff function against its declared
  effects/return contract (cite the contract from `shp explain`).
- **Violated invariant** — breaks an owned-resource invariant / cross-module rule
  (unaudited write, permission/ownership, atomicity) declared elsewhere.
- **Broken caller** — alters a contract in a way that breaks callers not in the diff
  (cite the caller edge from `shp graph <Symbol> --kind calls`).
- **Cross-component race / ordering** — shared resource mutated from multiple
  components without the coordination the model implies.

Add these to the SAME candidate list as Step 1.

## Step 3 — Score each candidate's confidence from its evidence (0.0-1.0)

For every candidate (local AND Shape), assign an internal confidence equal to how
concretely the EVIDENCE supports a real, reachable bug. Anchor the score to these
tiers — do not free-float it:

- **0.90-1.00** — Mechanical/provable from the diff alone: the changed code is wrong
  on its face (off-by-one, inverted condition, null deref on a value the diff shows
  can be null, leaked/unclosed resource, wrong variable, swapped args), and you can
  point to the exact line that breaks.
- **0.75-0.89** — Strong: a concrete defect that depends on one clear, verifiable
  fact — a Shape contract/invariant/caller edge you actually saw via `shp`, or a
  changed-behavior regression with a plausible triggering input you can name.
- **0.55-0.74** — Moderate: a likely bug whose triggering path or precondition you
  can describe but not pin to a specific line or a cited model fact.
- **0.30-0.54** — Weak: depends on assumptions about code you cannot see, or "this
  could be a problem if…" with no concrete trigger.
- **0.00-0.29** — Speculative/architectural: design opinion, "consider", refactor,
  or anything you cannot tie to a concrete failing input or a cited model fact.

Scoring rules (these protect recall — apply them honestly):

- **Evidence floors, never random.** The number must be justifiable by what you can
  cite. If you can name the exact wrong line, it is ≥0.90 — do not talk yourself
  down out of caution; solid local bugs are the recall foundation.
- **Shape evidence is a RAISE-only lever.** A cited contract/invariant/caller edge
  pushes a candidate UP a tier (it converts a guess into a grounded finding). The
  ABSENCE of a Shape fact never lowers a local candidate — most bugs are local and
  invisible to the model.
- **No double jeopardy.** Score on positive evidence FOR the bug. Lower the score
  only when you have a concrete reason the bug is weak; never lower it just because
  you feel unsure. When genuinely torn between two adjacent tiers, pick the HIGHER.
- One score per distinct issue; merge duplicates (keep the higher-scored phrasing).

## Step 4 — Gate at the calibrated bar, then emit

Emit a candidate as a comment **iff its confidence ≥ 0.70.** This single threshold
is the whole precision mechanism: it drops the diff-only reviewer's precision-leaking
guesses (the 0.30-0.69 band) while keeping every provable local bug (≥0.90), every
grounded Shape finding (≥0.75), and the strongest moderate-tier bugs (0.70-0.74).

- Do NOT emit anything below 0.70 — that band is where baseline precision dies.
- The bar is the ONLY filter. Do not additionally screen by bug category, and do not
  re-derive a separate keep/drop pass; the score already encodes the decision.
- Style/summaries/praise are never bugs — they never reach a gateable score at all.
- Drop pure duplicates that survived merging.
- If, after gating, NO candidate clears 0.70, emit `{"comments": []}` — an empty
  review is correct when nothing is solidly supported. Do not lower the bar to fill
  the file.
- Sanity check before writing: if you gated out a candidate whose exact wrong line
  you can still point to, you mis-scored it (it should be ≥0.90) — restore it. The
  bar removes guesses, not provable bugs.

## Output contract (required)

Write the final review to `./review.json`:

```json
{"comments": [{"path": "relative/file.ext", "line": 42, "body": "one concrete issue"}]}
```

One issue per comment; `path` is repo-relative and `line` is where the bug must be
fixed. `body` states the bug AND why it is a bug (name the violated
contract/invariant/caller when the model revealed it). Do NOT include confidence
scores or any of your gating reasoning in `body`. No style nitpicks, no summaries,
no praise. No candidate ≥ 0.70 → `{"comments": []}`.
