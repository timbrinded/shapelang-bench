---
name: v7-adversarial-self-verify
description: Phase 2 (scored). Review a PR diff for real bugs. Do a thorough diff-only review FIRST (recall), then use a whole-codebase Shape model (mounted at ./shape, shp CLI on PATH) to ADD cross-object bugs the diff hides. Then run a per-candidate ADVERSARIAL self-trial in the same pass: each candidate needs one concrete citation to KEEP, gets DROPPED only when you can state concrete counter-evidence refuting it, and stays KEEP whenever neither side is concrete. Emits review.json.
---

# Shape Review (Phase 2, scored) — v7 adversarial self-verify

Maximize F1 against human golden comments. Precision is the lever; local-bug recall is the
floor. The distinctive mechanism here is a **two-sided adversarial trial run per candidate,
in the same pass**: a candidate survives on an affirmative citation, dies only on an
affirmative refutation, and ties go to KEEP. This is not a confidence threshold (no scoring
bar) and not an output-boundary filter — it is a prosecution-vs-defense test of each finding.

Do everything in ONE pass, in this order. The Shape model is mounted at `./shape` (a real
dir) with `shp` on PATH — use it on every PR. Obey the inlined `shape-lang/SKILL.md` and
`cli-workflows.md`. Use ONLY real `shp` commands.

## Step 1 — Thorough diff review FIRST (recall foundation; never shortchange)

Before touching Shape, review the diff exactly as a rigorous diff-only reviewer would and
write down EVERY real defect you find as a candidate. Cover at least: logic errors,
off-by-one, null/None/undefined, inverted or wrong conditionals, error handling,
concurrency, resource leaks, security, incorrect API usage, and broken edge cases. Most
real bugs are local — this is the recall foundation and must be as complete as a dedicated
reviewer's. Finish it fully before spending any effort on the model. For each candidate,
note the exact changed line(s) it depends on.

## Step 2 — Shape augment (recall the diff alone cannot reach)

Now use the model for what the diff cannot show. Run `shp graph --stats` for the shape of
the system, then for each changed symbol run `shp explain <Symbol>` and
`shp graph <Symbol> --kind calls`. When a change touches guarded or governed code, also run
`shp obligations`, `shp memory`, and `shp check`. ADD candidates that require cross-object
understanding, each anchored to a specific model fact:
- **Dependency-contract misuse** — the diff calls a function defined outside the diff in a
  way that violates its declared effects / return contract.
- **Violated invariant or guard** — the change breaks an owned-resource invariant,
  permission/ownership rule, atomicity, or a Memory Guard / obligation declared elsewhere.
- **Broken caller** — the change alters a contract so callers not in the diff now break.
- **Cross-component race / ordering** — a shared resource is mutated from multiple
  components without the coordination the model declares.

These are ADDITIVE. Never use the model to suppress local findings, and never drop a
candidate just because the model is silent on it — model silence is not counter-evidence.

## Step 3 — Per-candidate adversarial self-trial (precision, same pass)

Take EVERY candidate from Steps 1 and 2 and put it on trial, one at a time. Run BOTH sides
explicitly before any verdict:

- **Prosecution (the citation).** State the ONE concrete piece of evidence that makes this
  a real bug. It must be exactly one of: (a) a specific violated Shape fact — name the
  contract/effect/invariant/guard from `shp explain`/`shp graph`/`shp obligations` it
  breaks; (b) the exact changed line and the wrong behavior it produces; or (c) a concrete
  value-flow — a value reaches a use where it is null/out-of-range/unvalidated/leaked,
  naming the source and the sink.
- **Defense (the refutation).** Try to break that citation: can you point to specific
  evidence the concern is NOT a bug? (The "violated" contract actually permits it; the path
  is unreachable; the value is already validated/guarded upstream per the diff or model; the
  model shows it is already handled.)

Then apply the verdict rule strictly, in this priority:

1. **Citation stands and no concrete refutation → KEEP**, and fold the citation into the
   comment body (name the violated contract/effect, or the precise wrong line/flow). A
   citation-backed body is more concrete, which itself raises judged precision.
2. **A concrete refutation defeats the citation → DROP it.** Dropping requires articulable
   counter-evidence, not doubt.
3. **Neither side is concrete — you can write neither a real citation nor a real refutation
   → KEEP it.** Ties go to KEEP. A prior dedicated drop-pass over-dropped real bugs and
   collapsed recall; ambiguity must resolve to KEEP, never to DROP.

This is precision by grounded prosecution and grounded refutation, never blanket
suppression. Specifically forbidden as drop reasons: "feels speculative," "low confidence,"
"probably fine," "the model doesn't mention it," or "to be safe." Only an articulable
refutation flips a KEEP to a DROP; absence of a citation alone does not — an uncitable but
unrefuted candidate stays KEEP.

Finally, dedupe (one comment per distinct bug at one site) and remove pure style nitpicks,
summaries, and praise — these are not bug candidates and need no trial to drop.

## Output contract (required)

Write the final review to `./review.json`:

```json
{"comments": [{"path": "relative/file.ext", "line": 42, "body": "one concrete issue"}]}
```

One issue per comment; `path` is repo-relative; `line` is the changed line the bug sits on;
`body` states the bug AND why in one or two sentences, naming the violated
contract/invariant/effect when the model revealed it. No style nitpicks, no summaries, no
praise. If there are no real bugs after the trial → `{"comments": []}`.
