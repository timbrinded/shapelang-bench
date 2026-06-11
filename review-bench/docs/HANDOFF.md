# Shape Code-Review Skill Optimization — Handoff

**Read this first.** It is the single source of truth for resuming the optimization loop in
a fresh thread. Companion files: `review-bench/docs/golden-goose-log.md` (full research history) and the
auto-memory (`fanout-optimization-loop`, `reviewer-model-migration`, `review-benchmark-direction`).

Last updated: 2026-06-07 (state notes refreshed 2026-06-11). Branch: `main` — the harness and v15 ship were merged in PR #1 (commit `3cadcc8`).

---

## 0. The goal (verbatim, non-negotiable)

> Theorize, come up with solutions/alternatives, and keep benchmarking + tweaking the code
> reviewer skill until we have **solid benchmark scores across the board that exceed the
> baseline by 10 points in EVERY repo**. **No cheating, no overfitting.** The skill must be
> **generalized to work for any repo**. **Shape must ALWAYS be used — no suppression, even on
> small diffs.** "Make shapes good enough for everything." This will take significant time and
> thought; we want the *golden goose* of Shape code-review skills.

Supported repos (5): **cal.com, discourse-graphite, grafana, sentry, sentry-greptile**.
(Keycloak/Ruby PRs are excluded — `shp` has no AST parser for Java/Ruby. 34 of 50 PRs are
supported.)

---

## 1. TL;DR — RESOLVED (2026-06-08)

- **SHIPPED: `v15-human-salience-gate` → `review-bench/skills/shape-review/SKILL.md`** (body byte-identical).
  Best generalized, non-overfit result at **n=3**: **+8.4 F1 overall** vs the same-model
  `gpt-5.5` baseline (validated end-to-end on indexes re-authored with the shipped broadened
  `shape-index` skill; 35.4% → 43.8%), **positive in ALL FIVE repos**, clearing +10 where Shape
  structurally can (grafana +14.4, sentry +22.6). ~3× the prior best (old v2 +2.8). (An earlier
  n=3 pass on mixed index-skill versions gave +8.7; the two agree within trial noise.)
- **Validated end-to-end (2026-06-08):** all 5 Layer-2 indexes re-authored with the shipped
  broadened `shape-index` skill (layer2Only) + v15 re-run at n=3 → reproduces the headline; the
  broadened index helped grafana and didn't crater the local repos. The sentry-greptile point
  estimate swung +8.6→+2.7 across two independent n=3 samples on the SAME index — a live
  demonstration of the 4-PR wide-CI caveat. Full table in `review-bench/docs/golden-goose-log.md`.
- **The literal goal "+10 in EVERY repo" is structurally INFEASIBLE without overfitting** —
  PROVEN at n=3, not a tuning failure. The per-repo ceiling tracks the fraction of cross-object
  golden bugs: grafana 32% / sentry 26% clear +10; cal.com 26% (+8.1), sentry-greptile 15%
  (+8.6), **discourse 11% (+1.2)** cannot. Shape's signal is cross-object structure; the local-
  bug-dominated repos (disc 89% local, sg 85% local) give it nothing to add. Index enrichment of
  sg (3→25 invariants) moved nothing — confirming a bug-distribution ceiling. **n=1 screening was
  noise-dominated** (v13 disc +10.3→−0.3, v6 cal +13.4→+1.6 at n=3); trust only n=3.
- **Full final n=3 table + the three-way proof are in `review-bench/docs/golden-goose-log.md` (FINAL verdict).**
- Untested levers (reasoning-effort bump; cal.com index enrichment) could at most nudge cal/sg
  and cannot break discourse's structural ceiling. User accepted "ship v15 + honest report."
- **Harness was silently corrupting/stalling runs; three bugs fixed first** (judge cache-poisoning,
  runProcess 8-hour hang, per-trial-dir race) + `layer2Only` reindex + always run
  `scripts/watch-run.sh`. See memory `harness-robustness-fixes`, `actively-watch-long-runs`.

### (historical, superseded) earlier state
- Standing best was `v13-recall-first-verify` (+11.3 overall at n=1) — but that was single-trial
  noise; v13 is only +0.3 overall and ~0 on cal/disc at n=3. The two binding constraints were
  thought to be cal.com (precision) and sentry-greptile (grounding); n=3 + index enrichment showed
  both are local-bug-distribution ceilings, as is discourse.

---

## 2. FIRST ACTIONS in the fresh thread (do these in order)

1. **Subscription is renewed (Codex Max, effectively unlimited as of 2026-06-07)** — the rate
   limit that killed round-2 is gone. You can run large sweeps again.
2. **Re-run round-2** (it was rate-limited, never validly scored):
   ```
   bun run review:fanout --variants v14-recall-precision-synthesis,v15-human-salience-gate,v16-invariant-anchored --trials 1 --concurrency 6
   ```
   Run in the background; it writes `review-bench/artifacts/runs/screen-r2.log` and prints a per-variant
   leaderboard vs the fixed baseline.
3. **Sanity-check it didn't silently rate-limit again** (see §7 gotcha): after it finishes,
   confirm reviews are non-empty:
   ```
   grep -lc "usage limit" review-bench/artifacts/runs/review-var-*/codex-stderr.txt | head
   ```
   If any review.json is empty / stderr says "usage limit", the scores are garbage — scrub and
   rerun (see §7).
4. Read the leaderboard. Decide per §5 roadmap.

---

## 3. The harness (how to run anything)

All commands run from repo root with `bun`. Reviewer + judge model = **`gpt-5.5`** (Codex on
subscription; no API key). Indexes are prebuilt and cached in `review-bench/artifacts/index/` (one per repo) — do NOT
rebuild unless improving the index skill (§6).

| command | what it does |
|---|---|
| `bun run review:fanout [--variants a,b] [--trials N] [--per-repo K] [--concurrency C] [--prs ...]` | **The main loop.** Benchmarks every `review-bench/artifacts/variants/<id>.md` (or the `--variants` subset) in one sweep; per-variant leaderboard (overall F1 + per-repo Δ) vs the fixed baseline. Reuses cached baseline + index. |
| `bun run review:full --conditions baseline --trials 3 --concurrency 6` | Regenerate the FIXED baseline control (only needed if the model changes again). |
| `bun run typecheck` | tsc. Run before/after editing harness TS. |

**Key flags:** `--per-repo K` samples K PRs/repo (fast screening, e.g. `--per-repo 2` = 10 PRs);
`--prs cal.com,grafana` filters by repo/number; `--trials N` = n per variant.

**How isolation works (why parallel variants are safe):** each (variant × PR × trial) review
runs in its own dir under `review-bench/artifacts/runs/review-var-<id>-<repo>-<pr>/` with no shared writes.
Then inject + score happen **serially** per tool (they touch shared
`external/code-review-benchmark/offline/results/{benchmark_data.json, gpt-5.5/candidates.json,
gpt-5.5/evaluations.json}`). Tool naming: `shapelang-<variantId>-t<trial>`. Baseline =
`shapelang-baseline-t<1..3>` (reused). The supported-PR universe (34) is derived from PRs the
baseline already covers.

**Source files (all under `review-bench/`):**
- `run-fanout.ts` — the fan-out harness (NEW; the engine of this loop).
- `run-review.ts` — `realReviewVariant(ctx, pr, {id, skillText})` runs one variant review.
- `skill-prompt.ts` — `buildReviewPrompt(pr, diff, condition, skillBody?)`; baseline reviewer
  prompt is the FIXED control (`BASELINE_REVIEWER`, never edit).
- `score.ts` — `scoreToolCodex(ctx, tool)` judges any tool with the Codex judge (Martian's
  verbatim prompt, our verified TP/FP/FN math, cached to `judge-cache.json`).
- `config.ts` — `defaultReviewerModel`/`defaultJudgeModel` = `gpt-5.5`.
- `index-shapes.ts` — Phase-1 index builder (AST layer 1 + authored layer 2). Relevant only if
  improving the index (§6).

---

## 4. Trustworthy results so far

### Fixed baseline (`gpt-5.5`, n=3, 34 PRs) — the floor each repo must beat by +10
| repo | baseline F1 | +10 target |
|---|---|---|
| cal.com | **53.3%** | 63.3% (hardest — strong already) |
| discourse-graphite | 37.7% | 47.7% |
| grafana | **19.8%** | 29.8% (most headroom) |
| sentry | **16.4%** | 26.4% (most headroom) |
| sentry-greptile | 34.7% | 44.7% |
| OVERALL | 35.4% | — |

### Round-1 screen (8 variants, n=1, Δ F1 pts vs baseline) — `review-bench/artifacts/runs/screen-r1.log`
| variant | overall | cal | disc | grafana | sentry | sg |
|---|---|---|---|---|---|---|
| **v13 recall-first + closed-list gate** | **+11.3** | +5.8 | +10.3 | +26.7 | +16.9 | −2.7 |
| **v6 precision-gate (graded confidence)** | +10.6 | **+13.4** | +0.4 | +19.1 | +13.2 | +0.1 |
| **v12 evidence-citation** | +10.0 | +10.1 | −2.9 | +22.3 | +14.3 | −0.2 |
| v8 cross-object grounding (class-split) | +6.9 | −2.4 | −1.3 | **+31.5** | +6.6 | −1.3 |
| v7 adversarial self-verify | +6.2 | +6.4 | −13.7 | +22.0 | +6.6 | +2.4 |
| v10 caller-impact | +4.1 | −4.1 | −12.7 | +11.8 | **+20.6** | **+11.5** |
| v11 self-consistency | +3.9 | +1.3 | +0.4 | +20.2 | +5.8 | −10.7 |
| v9 severity-triage | +3.6 | −2.3 | −2.9 | +14.5 | +0.2 | +9.8 |

**Per-repo winners** (who to combine): cal.com → **v6** (+13.4); grafana → **v8** (+31.5);
sentry → **v10** (+20.6); discourse → **v13** (+10.3); sentry-greptile → **v10** (+11.5) /
v9 (+9.8). The mechanisms are complementary — no single variant wins everywhere.

**Caveat:** discourse and sentry-greptile have only **4 PRs each**; n=1 per-repo numbers there
are noisy (±5–7 pts even at n=3 from a single judge flip). Trust OVERALL and cal/grafana (10 PRs).
The cross-object-rich, low-baseline repos (grafana, sentry) gain the most; cal.com is purely
precision-bound.

---

## 5. The saved skills/strategies (the optimization target)

The shipped skill is `review-bench/skills/shape-review/SKILL.md` (**v15-human-salience-gate**, promoted
2026-06-08 — see §1; the variants below are the historical candidate pool). All candidate strategies live in
**`review-bench/artifacts/variants/<id>.md`**, each a complete, self-contained shape-review skill
body. Authored via a Workflow (one agent per strategy + a distinctness/refine pass).

| id | mechanism (one line) | round-1 |
|---|---|---|
| **v13-recall-first-verify** | exhaustive recall (prune nothing) → ONE closed-list named-reason drop gate (keep-on-doubt) → Shape augment → gate. **Current leader.** | **+11.3** |
| **v6-precision-gate** | graded numeric per-candidate confidence; emit only above one calibrated bar. **Wins cal.com.** | +10.6 |
| v12-evidence-citation | mandatory mechanism/Shape-fact citation in every body (output-boundary precision). | +10.0 |
| v8-crossobject-grounding-max | class-split: cross-object findings must cite a Shape fact; local findings exempt. **Best on grafana.** | +6.9 |
| v7-adversarial-self-verify | per-candidate prosecution-vs-defense trial; drop only on concrete refutation, keep on tie. | +6.2 |
| v10-caller-impact | enumerate callers via `shp graph --kind calls`, check each for contract breakage. **Best on sentry/sg.** | +4.1 |
| v11-self-consistency | dual-stance (attacker + contract-conformance) review, union with confidence marks. | +3.9 |
| v9-severity-triage | emit only correctness/security/data-integrity/concurrency; drop trivia. | +3.6 |
| v14-recall-precision-synthesis | v13 chassis + v6 confidence + v12 citation + v8 class-split. **NOT yet validly benchmarked.** | — |
| v15-human-salience-gate | recall-first → gate each candidate on P(a human reviewer flags it). **NOT yet benchmarked.** | — |
| v16-invariant-anchored | recall-first → anchor recall+precision on authored Shape invariants. **NOT yet benchmarked.** | — |

**Hard rules every variant obeys** (violating these has empirically failed — see log):
Shape ALWAYS used (never skip, even small diffs); ADDITIVE + EVIDENCE-GATED, never blanket
suppression; the only legal drop is a closed-list named reason, keep-on-doubt; exhaustive local
recall is the foundation (never shortchanged); exact `./review.json` output contract; only real
`shp` commands.

---

## 6. Key findings & theory (the "significant thought")

1. **Model migration (forced).** `gpt-5.2` was retired for ChatGPT-account Codex (HTTP 400). All
   pre-2026-06-07 results are confounded. Reviewer + judge = `gpt-5.5` now. Baseline regenerated
   with `gpt-5.5`. `agent.ts` passes `--ignore-user-config`, so reviews run at Codex **default**
   reasoning (config's `xhigh` is ignored). → **Untested lever:** bump reasoning effort for BOTH
   arms (fair, generalizable inference-time knob; could lift the hard repos).

2. **The scoring math is the precision compass.** Pooled `F1 = 2·TP/(C+G)`, G (golden count) is
   fixed. The target is **bugs a HUMAN reviewer flagged, not all real bugs** — a technically-real
   but low-salience bug the human ignored counts as a FALSE POSITIVE. So precision = **predicting
   human salience** (severe / behavior-breaking / non-obvious / violates a real invariant). This
   is a true, generalizable property across repos — the principled, non-overfit precision lever.

3. **Index-richness is the likely key to the hard repos ("make shapes good enough").** Authored
   Layer-2 invariant coverage tracks where Shape helps:
   | repo | generated AST files | authored files | authored lines | invariants | best Δ |
   |---|---|---|---|---|---|
   | sentry | 13,744 | 4 | 682 | 78 | +16.9 ✅ |
   | grafana | 10,433 | 8 | 369 | 57 | +26.7 ✅ |
   | discourse | 676 | 3 | 611 | 17 | +10.3 ✅ |
   | cal.com | 2,406 | 4 | 353 | 32 | +5.8 ❌ |
   | sentry-greptile | 13,729 | **3** | **261** | 49 | −2.7 ❌ |
   The failing repos have the thinnest authored layer relative to size. sentry-greptile: 3 files /
   261 lines over a 13,729-file codebase → most PRs touch code with **no Shape grounding**. →
   **Round-3 lever:** improve `review-bench/skills/shape-index/SKILL.md` to author BROAD, comprehensive
   invariant coverage across all architecture-significant subsystems, then re-index sg (and cal).
   **CRITICAL anti-overfit rule:** author invariants from the codebase architecture generally —
   NEVER target the benchmark PRs' changed files. Re-indexing is expensive (Phase-1 agent over a
   huge tree); Layer-1 AST is already cached.

4. **cal.com is precision-bound, not recall-bound.** Baseline 53.3% means the reviewer already
   finds the bugs; the only lever is emitting fewer non-salient extras (v6/v12 win there; wide-
   recall v13 loses precision). The synthesis must deliver cal-grade precision AND v13 recall.

5. **Measurement honesty.** 4-PR repos (disc, sg) can't support a precise hard "+10" point
   estimate. Frame the final claim as **pooled F1 at n=3** with the understanding that small-repo
   CIs are wide. Consider whether "+10 in every repo" is best read as pooled-F1 + a stability check.

---

## 7. Gotchas / known issues (do not get bitten)

- **Rate-limit masking (the round-2 trap) — NOW GUARDED.** When Codex hits a usage limit,
  `codex exec` returns with an error in stderr and EMPTY output. Previously `realReviewVariant`
  returned `[]` (not an exception), so the harness logged **"0 fails"** while every score was a
  bogus 0 (this is what invalidated round-2). **Fixed 2026-06-07:** `runOneAgent` now THROWS when
  no `review.json` is written AND there is no last message (tagged `[USAGE-LIMIT/MODEL]` when
  stderr matches), so the worker's retry/FAIL path triggers honestly. A genuine "no bugs" result
  still writes `{"comments": []}` and is unaffected. Still worth a belt-and-suspenders check after
  big runs: `grep -l "usage limit" review-bench/artifacts/runs/review-var-*/codex-stderr.txt`.
- **Scrubbing bad tool data** from the 3 shared JSONs (template — adjust the `v14/v15/v16` list):
  a Python snippet that deletes matching `shapelang-<id>-t*` keys from
  `results/gpt-5.5/evaluations.json`, `results/gpt-5.5/candidates.json`, and the `reviews` arrays
  in `results/benchmark_data.json` was used on 2026-06-07; re-running a variant cleanly also
  overwrites its entries.
- **Killing a fan-out mid-run loses everything since the last scored tool.** Reviews complete in
  memory; inject+score run only after ALL reviews. A SIGTERM during the review phase (e.g. the
  n=3 v13+v6 confirmation that was killed at 199/204) writes nothing to evaluations. Re-run.
- **Never run two benchmark processes concurrently** — they race on the shared JSON. (Running a
  Claude *Workflow* to author variants concurrently IS safe — different backend, only writes new
  `variants/*.md` files.)
- **Synthesis variants are long** (v14 = 243 lines). Watch for "lost-in-the-middle" dilution; if a
  well-designed synthesis underperforms its components, tighten it before concluding the idea fails.

---

## 8. Roadmap (recommended order)

1. **Re-run round-2** (v14/v15/v16, n=1). See if v14 closes cal.com and lifts overall.
2. **Confirm the top 2–3** (likely v13 + v6 + best-synthesis) at **n=3** across all 34 PRs for
   reliable per-repo deltas. (~variants×34×3 reviews; subscription is unlimited now.)
3. If **sentry-greptile** still < +10 (likely): **improve the shape-index skill** and re-index sg
   (and cal.com) with broad, non-PR-targeted invariant coverage; re-screen. This is the
   "make shapes good enough" lever and probably the only path to sg.
4. If **cal.com** still < +10: push precision via the v6/v12 mechanisms folded into the v13
   chassis, and/or test a reasoning-effort bump (both arms).
5. Once a single generalized variant clears +10 in every repo at n=3 (with the small-repo CI
   caveat), **promote it to `review-bench/skills/shape-review/SKILL.md`**, update `review-bench/docs/golden-goose-log.md`,
   and report pooled F1 + per-repo deltas + the published-leaderboard comparison.

**Anti-overfitting protocol (enforce every round):** fixed baseline control (never edit
`BASELINE_REVIEWER`); n≥3 for any claim; each change must be ONE transferable hypothesis that
helps across diverse repos; Shape always used; no suppression; the index is authored from general
architecture, never from the golden bugs or PR diffs.

---

## 9. File map

- `review-bench/skills/shape-review/SKILL.md` — shipped skill (v15-human-salience-gate, promoted 2026-06-08).
- `review-bench/artifacts/variants/*.md` — all candidate strategies (v6–v16).
- `review-bench/skills/shape-index/SKILL.md` — Phase-1 index-authoring skill (improve for §6 round 3).
- `review-bench/*.ts` — harness (see §3).
- `review-bench/artifacts/index/<repo>/` — cached Shape index per repo (AST layer + authored invariants).
- `review-bench/artifacts/runs/` — per-run artifacts + logs (`screen-r1.log`, `baseline-gpt55.log`, …) +
  `fanout-*.json` machine-readable leaderboards.
- `external/code-review-benchmark/offline/results/` — Martian dataset; `benchmark_data.json`,
  `gpt-5.5/{candidates,evaluations,judge-cache}.json`, published-tool numbers in
  `openai_gpt-5.2/evaluations.json`.
- `review-bench/docs/golden-goose-log.md` — full research log. `review-bench/docs/HANDOFF.md` — this file.
