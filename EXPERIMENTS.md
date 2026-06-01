# Experiments

## The experiment

Replicate **constraint decay** (Dente et al., arXiv 2605.06445) and test whether
**ShapeLang** reduces it. Fixed API per task; one 0-shot generation per
(task, condition, level) under an increasing structural-constraint ladder
(L0 framework → L1 +architecture → L2 +SQLite → L3 +Sequelize). Conditions:
`control` (vanilla Codex, skills isolated) vs `shapelang` (same agent using the
ShapeLang skill). Dual metric: behavioral `Assert%` + static structural verifiers
(+ `shp` conformance). See `docs/preregistration.md`.

## Design history (for context)

The `/goal` framed this as "successive-generation" decay, so an earlier iteration
built a generational feature-bloat loop. That was abandoned: with the full prior
codebase carried forward each generation, a competent agent just appends features
and original conformance does not erode (control held 31/31 across 6 generations
on gpt-5.4-mini). That premise is not replicable as an experiment. The paper's
actual thesis is **constraint decay along a structural-constraint ladder, 0-shot**
— which is what this rig now implements, with ShapeLang as the intervention.

## Rig hardening (valid regardless of experiment shape)

Defects found and fixed so results reflect code, not test-rig/framework noise:

1. `exists()` returned false for directories → evaluator couldn't accept a
   candidate dir under current Bun. Fixed (stat-based).
2. Single fixed port → `EADDRINUSE`. Fixed: ephemeral free port per eval + retry.
3. Rig faults indistinguishable from code defects. Fixed: a `failureClass`
   taxonomy; rig classes (install/port/runner-timeout/runner-exit/capacity/
   harness) excluded + retried/resumed, never counted as decay.
4. Start-script path slip (`bun server.js` vs `src/server.js`) miscounted as a
   boot defect. Fixed: fall back to the real entry on module-not-found; genuine
   boot throws still fail.
5. No golden references / no validated structural verifier. Fixed: a
   known-correct reference per task + behavioral and structural mutants;
   `bun run verify-rig` gates the rig.

### Rig self-test (`bun run verify-rig`) — passes

- Golden references: 1.0 behavioral **and** structural at L0 and L3 (positive
  control on both of the paper's axes).
- `mutant:no-user-limit` → caught, `functional_fail` (behavioral detection).
- `mutant:upward-import` → structure fails while behavior stays 1.0 (structural
  detection power, cleanly isolated).

## Status

Apparatus complete and rig-validated; **not yet run at scale.**
`gpt-5.3-codex-spark` is weekly usage-limited (reset ~Jun 5); `gpt-5.4-mini`
works for smoke tests; `gpt-5.5` tiers are the path for a capable-model run. To
run when a model is available:

```bash
bun run verify-rig
bun run bench -- --experiment decay --conditions control,shapelang \
  --levels L0,L1,L2,L3 --trials 5 --copy-auth true \
  --model gpt-5.3-codex-spark         # or --model gpt-5.5 -c model_reasoning_effort=high
bun run analyze -- --experiment decay
```

Conclusions follow the pre-registered rules; results land in
`runs/decay/analysis.json` and are summarized here once collected.
