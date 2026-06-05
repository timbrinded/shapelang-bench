---
name: shape-review
description: Phase 2 (scored). Review a pull-request diff for real bugs, correctness, and security issues. In the shape condition a whole-codebase Shape model is mounted at ./shape with the shp CLI on PATH; PULL only the parts relevant to the change rather than reading it all. Emits line-level review comments as review.json. Built on the upstream shape-lang skill.
---

# Shape Review (Phase 2 — the scored phase)

Upstream `shape-lang` "review" means Shape *conformance validation*; this skill
is general bug-finding on a diff (what the benchmark scores). Obey the inlined
`shape-lang/SKILL.md` and `cli-workflows.md`; this file adds the review loop, the
PULL-based use of the Shape model, and the output contract.

Only `review.json` is scored. The Shape model is available in the `shape`
condition and absent in `baseline`; otherwise identical, so the difference
isolates Shape's contribution.

## Do a normal review first (don't let Shape narrow you)

Review the diff for ALL real defects — logic errors, null/None, off-by-one, error
handling, races, security, AND contract/architecture violations. The Shape model
is a **supplement** to confirm/extend findings and catch cross-file issues, NOT a
replacement for ordinary bug-finding. Do not drop a real local bug just because it
isn't "architectural."

## The Shape model is PULL-based (shape condition only)

A whole-codebase Shape model is mounted at `./shape` (a real directory) and the
`shp` CLI is on PATH. It is LARGE — do **not** read it all or dump it. Traverse it
on demand and pull only what bears on the changed code.

**You MUST use the `shp` CLI to traverse the model — it is the ergonomic, correct
interface; do not just grep raw `.shape` files.** Specifically:

- You **MUST** start with `shp graph --stats` to orient (components, resources,
  relation kinds).
- For every symbol/component/function touched by the diff (and its key
  dependencies), you **MUST** run `shp explain <Symbol>` to read its declared
  effects, grants, owned resources, and invariants.
- You **MUST** run `shp graph <Symbol> --kind calls` (and other relation kinds as
  relevant) to find callers/callees and structural dependencies the diff does not
  show.
- Use `shp check` / `shp analyze` when verifying a suspected contract/effect
  violation.

You MAY additionally read specific files (authored architecture/invariants live in
`./shape/<module>/*.shape`; per-file AST contracts under
`./shape/generated/ast/<source-path>.shape`), but `shp graph`/`shp explain` are
required, not optional.

Use the model to answer questions the diff alone can't: does this change violate a
stated invariant? does it use a dependency inconsistently with that dependency's
declared contract (defined outside the diff)? would it break known callers?

## Procedure

1. Read the diff; list changed files/functions and what changed.
2. Find the real bugs in the diff directly (normal review).
3. **MUST**: orient with `shp graph --stats`, then for the changed symbols and
   their dependencies run `shp explain <Symbol>` and `shp graph <Symbol> --kind
   calls`. Use this to check: does the change violate a stated invariant, use a
   dependency against its declared contract, or break a caller? Cite the
   invariant/contract in the comment when the model is what revealed the issue.
4. Pin each issue to a changed file and line. Report a finding if it's a real
   defect — whether local or architectural.

## Output contract (required)

Write the review to `./review.json`:

```json
{"comments": [{"path": "relative/file.ext", "line": 42, "body": "one concrete issue"}]}
```

`path` repo-relative; `line` a real changed line; `body` = one specific
bug/correctness/security concern and why. One issue per comment, no style
nitpicks, no summaries. No defects → `{"comments": []}`.
