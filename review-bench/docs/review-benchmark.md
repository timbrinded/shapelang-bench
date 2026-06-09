# Shape Code-Review Benchmark (Martian)

This benchmark measures whether Shape improves AI **code review**, and reports a
number directly comparable to the industry. It reuses the **Martian Code Review
Bench** (the only independent, open-source, reproducible code-review suite) as
the scorer and runs our Shape-based reviewer as just another "tool" alongside
the published ones (CodeRabbit, Bugbot, Greptile, Qodo, Copilot, Devin, …).

It is separate from the constraint-decay generation benchmark in the repo root;
nothing here touches that flow.

## Two phases

- **Phase 1 — Shape indexing (preparation, NOT scored, cacheable).** An agent
  indexes the PR's project from scratch (AST generation + authored shapes) into a
  `shape/` model, cached per `(repo, baseSha)` under `index/`. Reused across runs
  by default; force a rebuild with `--reindex`.
- **Phase 2 — Shape-aware code review (the only scored phase).** A review agent
  reviews the PR diff and emits line-level comments. Two conditions: `baseline`
  (no Shape index) and `shape` (Shape index in context). Identical otherwise, so
  the F1 delta isolates Shape's effect.

Both phases run the **real shapelang skills**. The prompts are assembled from
`review-bench/skills/shape-index/SKILL.md` and `review-bench/skills/shape-review/SKILL.md` (our authored
extensions) plus the upstream `external/shapelang/skill/shape-lang/SKILL.md` and
its `references/`, inlined verbatim. These skills are the thing we optimize: if a
score is low, edit the skill and re-run Phase 2. If editing the skill cannot move
it, the limitation is in `shp` itself.

## How Martian scores (what it needs)

`external/code-review-benchmark/offline/` holds 50 PRs from 5 repos with
human golden comments embedded in `results/benchmark_data.json` (already
downloaded — Steps 0/1 / GitHub forking are skipped). The pipeline:

1. `step2_extract_comments` — turn review prose into candidate issues (we skip
   this for our tool by writing line-level candidates directly).
2. `step2_5_dedup_candidates` — group duplicate candidates → `dedup_groups.json`.
3. `step3_judge_comments` — LLM judge matches each candidate to a golden comment
   → `evaluations.json`. **Precision = TP/(TP+FP), Recall = TP/(TP+FN), F1**.

## The judge (no API key, no cost)

We do not use Martian's hosted judge or any API key. The judge runs on the
**Codex subscription** via `codex exec` (the `codex` backend, default), reusing
Martian's **verbatim** judge prompt and our verified TP/FP/FN math, so the
decision is methodologically the same — only the engine differs. Verdicts are
cached in `results/<judge-model>/judge-cache.json`, so iterating re-judges only
changed candidates. Results live in `results/<judge-model>/` (e.g.
`results/gpt-5.5/`), separate from the published dirs so nothing is clobbered.

`review:score` backends: `codex` (default), `stub` (hermetic smoke only),
`martian` (the original uv/Python judge — only this one needs `MARTIAN_API_KEY`).

## Prerequisites (live runs)

- `bun` (this harness) and **Codex on `PATH`, logged in** (`~/.codex/auth.json`,
  `auth_mode: chatgpt`). The reviewer *and* the judge both run on this.
- `gh` authenticated (fetch PR diffs/base SHAs).
- The `shp` CLI, built from the vendored shapelang branch (`external/shapelang`)
  into a self-contained binary with bundled tree-sitter parsers:
  `bun install --cwd external/shapelang` once, then `bun run review:build-shp`.
  The binary (`review-bench/artifacts/shp-build/shp`) works offline — no parser download, no
  `SHP_TREE_SITTER_ASSET_ROOT`. Re-run `review:build-shp` after pulling new
  shapelang fixes onto the branch.
- No LLM API key is required for the default `codex` judge. (Only the optional
  `--judge martian` backend needs `uv sync` + `MARTIAN_API_KEY`.)

> The bench consumes shapelang via its built CLI, so fixes land on the shapelang
> branch (PR) rather than as bench-side workarounds. Supported AST languages:
> TS/JS, Go, Python, Rust (Java/Ruby PRs are auto-skipped).

## Workflow

```bash
# 0. End-to-end gate — hermetic (no network/model), then 1 real PR.
bun run review:smoke
bun run review:smoke --live            # needs the prerequisites above

# 1. Phase 1: build/reuse the Shape index (cached under index/).
bun run review:index --prs cal_dot_com,sentry        # start with a subset

# 2. Phase 2: review both conditions (Phase 1 reused by default).
bun run review:run --condition baseline --model gpt-5.2 --prs cal_dot_com,sentry
bun run review:run --condition shape    --model gpt-5.2 --prs cal_dot_com,sentry

# 3. Score with the Codex-subscription judge (default), then compare.
#    --model is the judge model (default gpt-5.5); JUDGE_CONCURRENCY tunes parallelism.
bun run review:score --condition baseline --model gpt-5.5
bun run review:score --condition shape    --model gpt-5.5
bun run review:summarize --model gpt-5.5
```

Iterate by editing `review-bench/skills/shape-review/SKILL.md` and re-running Phase 2 + score;
the Phase-1 index stays cached.

## Smoke test (the end-to-end gate)

`bun run review:smoke` runs the full chain Phase 1 → Phase 2 → score → summarize
against tiny fixtures (`review-bench/fixtures/review-smoke/`) with a deterministic stub judge,
and asserts the oracle: shape = 1 TP / 1 FP / 0 FN → **precision 0.5, recall 1.0,
F1 0.667**, with baseline strictly lower. It needs no network or model, so it
proves the plumbing and the scoring math before any real run. `--live` exercises
the real rig (Codex reviewer + shp + gh + Codex judge) on one PR — no API key.

## Reproducibility notes

- **Rig sanity:** the headline is the internal **shape − baseline F1 delta**,
  where judge-model variance largely cancels. To sanity-check absolute levels,
  compare baseline against Martian's published numbers — but note our judge is a
  Codex model, not their hosted judge, so absolute values are only approximate.
- Real runs append our tool to the tracked `benchmark_data.json`; our candidates/
  evaluations go to a fresh `results/<judge-model>/` dir (untracked) so published
  files are untouched. Restore the one tracked file with:
  `git -C external/code-review-benchmark checkout -- offline/results/benchmark_data.json`.
