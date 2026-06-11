import { exists, joinPath, parseArgs, readJson, writeJson } from "../src/bun-utils.ts";
import { realContext, type ReviewContext } from "./context.ts";
import { reviewConditions, toolName, type ReviewCondition } from "./config.ts";
import { loadBenchmarkData, modelDir, runUvStep } from "./martian.ts";
import { evaluateReview, stubMatch, type MatchFn } from "./scoring.ts";
import { assertRealRunPrereqs } from "./preflight.ts";
import { ensureJudgeHome, judgePairs, PAIR_DELIMITER } from "./codex-judge.ts";
import type { CandidatesFile, EvaluationsFile } from "./types.ts";

// codex  — judge via `codex exec` on the subscription (no API key, no cost)
// stub   — deterministic local matcher (hermetic smoke only)
// martian — Martian's uv/Python judge (needs MARTIAN_API_KEY)
export type JudgeBackend = "codex" | "stub" | "martian";

// Candidate texts for a tool: prefer extracted candidates, else raw comment bodies
// (mirrors step3_judge_comments.get_candidates).
function candidateTexts(
  candidates: CandidatesFile,
  url: string,
  tool: string,
  rawBodies: string[],
): string[] {
  const fromCandidates = candidates[url]?.[tool]
    ?.map((candidate) => candidate.text)
    .filter((text): text is string => Boolean(text));
  return fromCandidates && fromCandidates.length > 0 ? fromCandidates : rawBodies.filter(Boolean);
}

// Stub judge (hermetic): deterministic local matcher, no network/model. Mirrors
// step3's candidate selection (prefer candidates.json, else raw comment bodies)
// and writes evaluations.json in Martian's exact schema.
async function scoreStub(
  ctx: ReviewContext,
  condition: ReviewCondition,
  trial?: number,
): Promise<EvaluationsFile> {
  const tool = toolName(condition, trial);
  const dir = modelDir(ctx.offlineDir, ctx.judgeModel);
  const data = await loadBenchmarkData(ctx.offlineDir);

  const candidatesFile = joinPath(dir, "candidates.json");
  const candidates: CandidatesFile = (await exists(candidatesFile))
    ? await readJson<CandidatesFile>(candidatesFile)
    : {};

  const evaluationsFile = joinPath(dir, "evaluations.json");
  const evaluations: EvaluationsFile = (await exists(evaluationsFile))
    ? await readJson<EvaluationsFile>(evaluationsFile)
    : {};

  for (const [url, entry] of Object.entries(data)) {
    const review = (entry.reviews ?? []).find((item) => item.tool === tool);
    if (!review) continue;

    const texts = candidateTexts(
      candidates,
      url,
      tool,
      review.review_comments.map((comment) => comment.body),
    );

    const result = evaluateReview(entry.golden_comments ?? [], texts, stubMatch);
    result.tool = tool;
    result.pr_url = url;
    result.repo_name = entry.source_repo ?? null;
    (evaluations[url] ??= {})[tool] = result;
  }

  await writeJson(evaluationsFile, evaluations);
  return evaluations;
}

// Codex judge: per-pair semantic match via `codex exec` (subscription auth),
// using Martian's verbatim judge prompt and our verified TP/FP/FN math. No API
// key, no cost. Verdicts cached to judge-cache.json so re-runs are cheap.
async function scoreCodex(
  ctx: ReviewContext,
  condition: ReviewCondition,
  trial?: number,
): Promise<EvaluationsFile> {
  return scoreToolCodex(ctx, toolName(condition, trial));
}

// Score one arbitrary tool name with the Codex judge. Same logic as the
// condition-based path but keyed by an explicit tool, so the fan-out harness can
// judge per-variant tools (e.g. shapelang-<variantId>-t1) that have no fixed
// ReviewCondition. Reads/writes the shared evaluations.json + judge-cache.json,
// so callers MUST invoke this serially across tools (no concurrent scoring).
export async function scoreToolCodex(ctx: ReviewContext, tool: string): Promise<EvaluationsFile> {
  const dir = modelDir(ctx.offlineDir, ctx.judgeModel);
  const data = await loadBenchmarkData(ctx.offlineDir);

  const candidatesFile = joinPath(dir, "candidates.json");
  const candidates: CandidatesFile = (await exists(candidatesFile))
    ? await readJson<CandidatesFile>(candidatesFile)
    : {};

  const evaluationsFile = joinPath(dir, "evaluations.json");
  const evaluations: EvaluationsFile = (await exists(evaluationsFile))
    ? await readJson<EvaluationsFile>(evaluationsFile)
    : {};

  const cacheFile = joinPath(dir, "judge-cache.json");
  const cacheObject: Record<string, boolean> = (await exists(cacheFile))
    ? await readJson<Record<string, boolean>>(cacheFile)
    : {};
  const cache = new Map(Object.entries(cacheObject));

  const { codexHome, cwd } = await ensureJudgeHome(ctx.runsDir);
  const judgeOptions = {
    model: ctx.judgeModel,
    codexHome,
    cwd,
    concurrency: Number(Bun.env.JUDGE_CONCURRENCY ?? 6),
    timeoutMs: 120_000,
    cache,
  };

  for (const [url, entry] of Object.entries(data)) {
    const review = (entry.reviews ?? []).find((item) => item.tool === tool);
    if (!review) continue;

    const golden = entry.golden_comments ?? [];
    const texts = candidateTexts(candidates, url, tool, review.review_comments.map((c) => c.body));
    const matched = await judgePairs(
      golden.map((gc) => gc.comment),
      texts,
      judgeOptions,
    );
    const match: MatchFn = (g, c) => matched.has(`${g}${PAIR_DELIMITER}${c}`);

    const result = evaluateReview(golden, texts, match);
    result.tool = tool;
    result.pr_url = url;
    result.repo_name = entry.source_repo ?? null;
    (evaluations[url] ??= {})[tool] = result;

    // Persist incrementally so a long run is resumable.
    await writeJson(evaluationsFile, evaluations);
    await writeJson(cacheFile, Object.fromEntries(cache));
  }

  return evaluations;
}

// Real Martian judge: dedup + LLM judge via the vendored pipeline.
async function scoreMartian(ctx: ReviewContext, condition: ReviewCondition): Promise<EvaluationsFile> {
  const tool = toolName(condition);
  const dir = modelDir(ctx.offlineDir, ctx.judgeModel);
  const dedupPath = joinPath(dir, "dedup_groups.json");

  await runUvStep(ctx.offlineDir, "step2_5_dedup_candidates", ["--tool", tool, "--force"], ctx.judgeModel);
  await runUvStep(
    ctx.offlineDir,
    "step3_judge_comments",
    ["--tool", tool, "--force", "--dedup-groups", dedupPath],
    ctx.judgeModel,
  );

  const evaluationsFile = joinPath(dir, "evaluations.json");
  return (await exists(evaluationsFile)) ? await readJson<EvaluationsFile>(evaluationsFile) : {};
}

export function scoreCondition(
  ctx: ReviewContext,
  condition: ReviewCondition,
  judge: JudgeBackend,
  trial?: number,
): Promise<EvaluationsFile> {
  if (judge === "stub") return scoreStub(ctx, condition, trial);
  if (judge === "martian") return scoreMartian(ctx, condition);
  return scoreCodex(ctx, condition, trial);
}

if (import.meta.main) {
  const args = parseArgs();
  const condition = (args.condition ?? "baseline") as ReviewCondition;
  if (!reviewConditions.includes(condition)) {
    throw new Error(`unknown condition: ${condition}`);
  }
  const judge = (args.judge ?? "codex") as JudgeBackend;
  const ctx = realContext(args.model ? { judgeModel: args.model } : {});
  await assertRealRunPrereqs({ needShp: false });
  await scoreCondition(ctx, condition, judge);
  console.log(`scored ${toolName(condition)} via ${judge} judge`);
}
