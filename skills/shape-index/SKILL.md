---
name: shape-index
description: Phase 1 (preparation, not scored). On top of an already-generated whole-codebase AST Shape context, author higher-level architecture, boundary, and INVARIANT shapes that a downstream reviewer can use — grounded in the generated AST anchors. Built directly on the upstream shape-lang skill and the shp CLI.
---

# Shape Index (Phase 1, preparation — NOT scored)

This skill exists because the upstream `shape-lang` skill covers *incremental*,
changed-file authoring, not building a reviewable model of an entire project. It
is a faithful extension: obey every rule in the inlined `shape-lang/SKILL.md` and
`cli-workflows.md`; this file adds the whole-codebase authoring workflow. Assume
`shp` is on `PATH`.

Nothing here is scored. The output (the `shape/` model) is preparation for the
scored Phase 2 review. Optimize it so the reviewer has an accurate, navigable map
of the architecture and the invariants the code must uphold.

## Two layers

- **Layer 1 — generated AST (already done).** `shape/generated/ast/` already
  contains deterministic, source-backed AST Shape context for the whole codebase:
  per-function anchors, candidate effects, and `source` refs. This is the
  concrete, low-level layer. Do NOT edit it.
- **Layer 2 — authored architecture (your job).** Author `.shape` files under
  `shape/` (NOT under `shape/generated/`) capturing what the AST cannot:

  1. **Components & responsibilities** — the real architectural units (services,
     routers, adapters, data access, domain) and what each is responsible for.
  2. **Code boundaries / allowed dependencies** — which components may depend on
     which; encode forbidden directions as `forbid` rules where they matter.
  3. **Owned resources & business logic** — the key domain resources and the
     rules that govern them.
  4. **Invariants that must hold** — security/permission rules, data-integrity
     and transactional constraints, and contracts between modules (e.g. "this
     helper returns the parsed credential, never the raw response"; "only the
     owner or an admin may mutate X"; "every write to Y is audited").

## Grounding (important)

Every authored claim must be **traceable to concrete code**. Reference the
generated AST anchors/resources and `source` refs so an invariant points at the
exact function/file it governs — e.g. relate an authored component or invariant
to the generated AST resource for `parseRefreshTokenResponse`, or attach
`source ts("packages/.../file.ts#fn")`. Prefer prelude relation kinds
(`calls`, `provides`, `coordinated_call`, `callbacks`).

## Procedure

1. Survey: use the directory layout, `shape/generated/ast/manifest.json`, and
   `shp graph --stats` to find the architecture-significant areas. Sample key
   modules; do not read every file.
2. Author Layer 2 shapes per the categories above, grounding each in Layer 1.
3. Model honest uncertainty (`effects unknown`) rather than inventing claims.
   Keep final forbids final.
4. Validate: `shp fmt --check` then `shp check`. Investigate with `shp explain`,
   `shp graph`, `shp analyze` as needed.

## Done when

`shape/` contains an accurate Layer-2 architecture+invariant model (covering the
significant areas, grounded in the generated AST), and `shp fmt --check` +
`shp check` pass.
