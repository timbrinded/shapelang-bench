# Experiments

## The experiment

**Does successive-generation LLM code generation degrade conformance to the
original spec under feature bloat, and does ShapeLang slow it?** See
`docs/preregistration.md`. Conditions: `control` (vanilla Codex) vs `shapelang`
(Codex using the ShapeLang skill). gen 0 builds the spec; each later generation
adds a new feature on top of the prior code; every generation is re-scored
against the original blind tests.

## Rig hardening (valid regardless of apparatus)

The harness was rebuilt so results reflect code defects, not test-rig or
local-framework noise. Defects found and fixed:

1. `exists()` returned false for directories (Bun.file().exists() is file-only),
   so the evaluator could not accept a candidate directory at all under current
   Bun. Fixed with a stat-based check.
2. A single fixed port (3137) invited `EADDRINUSE`. Fixed: an ephemeral free port
   per evaluation with conflict detection + retry.
3. Rig faults were indistinguishable from code defects. Fixed: a `failureClass`
   taxonomy; rig classes (install/port/runner-timeout/runner-exit/capacity/harness)
   are excluded from the metric and auto-retried/resumed, never counted as decay.
4. A start-script path slip (`bun server.js` while the entry is `src/server.js`)
   was being miscounted as a boot defect and disproportionately hit layered
   candidates. Fixed: the evaluator falls back to the real entry on a
   module-not-found fast-fail; genuine boot throws still fail.
5. Stale `EXPECTED_ASSERTIONS` constants were synced to real oracle counts.
6. No golden references existed. Fixed: a known-correct reference per task plus a
   negative-control mutant; `bun run verify-rig` gates the rig.

### Rig self-test

`bun run verify-rig` passes: all five golden references score 1.0 on the blind
oracle at L0 and L3, and a no-per-user-limit mutant is caught and classed
`functional_fail`.

## Status of results

**The first run (`runs/main`) used a flawed apparatus and is NOT valid evidence
about ShapeLang. Do not cite it.** Its `shapelang`/`shape` arm was an inlined,
frozen contract that the harness pasted and validated for the agent — not the
agent *using* the ShapeLang skill — and its generational loop instructed the
agent to "refactor and preserve behavior" instead of adding features, so it
measured the wrong thing (and unsurprisingly found little decay). It also carried
an `L0–L3` constraint-level axis and a `prose` arm that are not part of this
experiment. The apparatus has since been corrected:

- conditions are now `control` vs `shapelang`, where `shapelang` points the agent
  at the real skill (`/home/timbo/.claude/skills/shape-lang`) and the agent runs
  `shp` itself; the control runs with skills isolated;
- the decay driver is additive **feature bloat** (`tasks/<id>/features.json`),
  scored against the original blind oracle each generation;
- the legacy level/prose machinery and `runs/main` are superseded.

**The corrected experiment has not yet been run.** `gpt-5.3-codex-spark` is
usage-limited (weekly cap; next reset reported ~Jun 5), so the run awaits either
that reset or a `gpt-5.5` tier. To run when a model is available:

```bash
bun run verify-rig
bun run bench -- --experiment decay --conditions control,shapelang --trials 5 \
  --model gpt-5.3-codex-spark --copy-auth true     # or: --model gpt-5.5 -c model_reasoning_effort=high
bun run analyze -- --experiment decay
```

Conclusions follow the pre-registered rules. Results will be written to
`runs/decay/analysis.json` and summarized here once collected.
