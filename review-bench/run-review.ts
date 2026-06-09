import {
  exists,
  joinPath,
  parseArgs,
  readJson,
  readText,
  removePath,
  runProcess,
  writeJson,
  writeText,
} from "../src/bun-utils.ts";
import { realContext, type ReviewContext } from "./context.ts";
import {
  reviewConditions,
  smokeFixturesDir,
  toolName,
  type ReviewCondition,
} from "./config.ts";
import {
  benchmarkDataPath,
  injectTool,
  loadBenchmarkData,
  mergeCandidates,
  modelDir,
} from "./martian.ts";
import { indexKey, listPrs } from "./prs.ts";
import { indexDirFor, writeShpShim } from "./index-shapes.ts";
import { runCodexAgent } from "./agent.ts";
import { buildReviewPrompt, parseReviewComments } from "./skill-prompt.ts";
import type { PrSpec, ReviewComment } from "./types.ts";

// Smoke driver: read a canned reviewer output from fixtures (no Codex/gh/shp).
async function smokeReview(condition: ReviewCondition): Promise<ReviewComment[]> {
  const path = joinPath(smokeFixturesDir, `review-${condition}.json`);
  const items = await readJson<Array<{ path?: string | null; line?: number | null; body: string }>>(
    path,
  );
  return items.map((item) => ({
    path: item.path ?? null,
    line: item.line ?? null,
    body: item.body,
    created_at: null,
  }));
}

// Fetch the unified PR diff (the reviewer's primary input for both conditions).
async function prDiff(pr: PrSpec): Promise<string> {
  const diffResult = await runProcess("gh", ["pr", "diff", String(pr.prNumber), "--repo", pr.repo], {
    cwd: ".",
    env: { ...Bun.env, PATH: Bun.env.PATH ?? "" },
    timeoutMs: 120_000,
  });
  return diffResult.stdout;
}

// Real driver: fetch the diff, run the shape-review skill via Codex, parse review.json.
// Exported so a full sweep can run many of these concurrently (injection into
// benchmark_data is done serially afterwards to avoid races).
export async function realReview(
  ctx: ReviewContext,
  pr: PrSpec,
  condition: ReviewCondition,
  trial?: number,
): Promise<ReviewComment[]> {
  const diff = await prDiff(pr);
  // Single integrated call per condition (the v2 architecture — splitting into
  // separate add/drop passes backfired). Shape mounts the model at ./shape.
  // The trial MUST be in the tag: concurrent trials of the same (pr,condition)
  // otherwise share one runDir and race on the ./shape copy (rm -rf vs cp -R).
  const tag = trial ? `${condition}-t${trial}` : condition;
  return runOneAgent(ctx, pr, tag, await buildReviewPrompt(pr, diff, condition), condition === "shape");
}

// A shape-review skill variant under test: an id (used for tool/runDir namespacing)
// and the skill body the agent reviews under (in place of the on-disk SKILL.md).
export type ReviewVariant = { id: string; skillText: string };

// Fan-out driver: review one PR under one variant's skill body. Always the shape
// condition (model mounted). Namespaced by variant id so concurrent variants
// never share a run directory.
export async function realReviewVariant(
  ctx: ReviewContext,
  pr: PrSpec,
  variant: ReviewVariant,
  trial?: number,
): Promise<ReviewComment[]> {
  const diff = await prDiff(pr);
  const prompt = await buildReviewPrompt(pr, diff, "shape", variant.skillText);
  // Trial in the tag → unique runDir per (variant,pr,trial). Without it, concurrent
  // trials of the same (variant,pr) share a runDir and race on the ./shape copy,
  // throwing "Failed with exit code 1" (rm -rf vs cp -R) and corrupting survivors.
  const tag = trial ? `var-${variant.id}-t${trial}` : `var-${variant.id}`;
  return runOneAgent(ctx, pr, tag, prompt, true);
}

// Run one review agent in an isolated workdir; optionally mount the repo's Shape
// model at ./shape with the shp shim on PATH. Returns parsed review comments.
async function runOneAgent(
  ctx: ReviewContext,
  pr: PrSpec,
  tag: string,
  prompt: string,
  mountShape: boolean,
): Promise<ReviewComment[]> {
  const runDir = joinPath(ctx.runsDir, `review-${tag}-${pr.repoName}-${pr.prNumber}`);
  const workDir = joinPath(runDir, "work");
  await writeText(joinPath(workDir, ".gitkeep"), "");

  let pathPrefix: string | undefined;
  if (mountShape) {
    const indexDir = indexDirFor(ctx, indexKey(pr.repoName)); // one index per repo
    const shapeCopy = joinPath(workDir, "shape");
    await removePath(shapeCopy);
    await runProcess("cp", ["-R", joinPath(indexDir, "shape"), shapeCopy], {
      cwd: ".",
      env: { ...Bun.env, PATH: Bun.env.PATH ?? "" },
      timeoutMs: 120_000,
    });
    const binDir = joinPath(ctx.indexDir, ".bin");
    await writeShpShim(binDir);
    pathPrefix = binDir;
  }

  const { codex, lastMessage } = await runCodexAgent({
    prompt,
    workDir,
    runDir,
    model: ctx.reviewerModel,
    timeoutMs: ctx.timeoutMs,
    copyAuth: true,
    pathPrefix,
  });
  const reviewPath = joinPath(workDir, "review.json");
  const haveFile = await exists(reviewPath);
  const raw = haveFile ? await readText(reviewPath) : lastMessage;

  // Honest-failure guard: a well-behaved agent ALWAYS writes review.json (even
  // `{"comments": []}` for no bugs). If the file is absent AND there is no
  // parseable last message, the run produced nothing — a usage-limit, timeout,
  // or crash. THROW so the caller's retry/FAIL path triggers instead of silently
  // recording an empty review (which scores as a real 0 and corrupts the sweep).
  // The classic trap: Codex returns code 0 with a "usage limit" stderr and empty
  // output, which otherwise looks like a clean "found no bugs".
  if (!haveFile && lastMessage.trim() === "") {
    const err = codex.stderr.trim();
    const rateLimited = /usage limit|rate.?limit|not supported/i.test(err);
    const tail = err.slice(-300).replace(/\s+/g, " ");
    throw new Error(
      `${tag} ${pr.repoName}#${pr.prNumber}: agent produced no review.json and no output` +
        `${rateLimited ? " [USAGE-LIMIT/MODEL]" : ""} (code=${codex.code}${codex.timedOut ? ",timedOut" : ""}; stderr: ${tail})`,
    );
  }
  return parseReviewComments(raw);
}


// Phase 2 — produce our tool's reviews for each PR and wire them into the
// Martian pipeline inputs (benchmark_data.json + candidates.json). The ONLY
// scored phase. Returns the reviews keyed by golden URL.
export async function phase2Review(
  ctx: ReviewContext,
  prs: PrSpec[],
  condition: ReviewCondition,
  trial?: number,
): Promise<Map<string, ReviewComment[]>> {
  const tool = toolName(condition, trial);
  const reviewsByUrl = new Map<string, ReviewComment[]>();

  for (const pr of prs) {
    const comments = ctx.smoke
      ? await smokeReview(condition)
      : await realReview(ctx, pr, condition, trial);
    reviewsByUrl.set(pr.goldenUrl, comments);
  }

  // step3 iterates over benchmark_data reviews, so our tool must be present there.
  const data = await loadBenchmarkData(ctx.offlineDir);
  injectTool(data, tool, reviewsByUrl);
  await writeJson(benchmarkDataPath(ctx.offlineDir), data);

  // Write candidates directly (line-level comments are direct candidates), so
  // the judge does not need the LLM extraction step for our tool.
  const candidatesFile = joinPath(modelDir(ctx.offlineDir, ctx.judgeModel), "candidates.json");
  await mergeCandidates(candidatesFile, tool, reviewsByUrl);

  await writeJson(
    joinPath(ctx.runsDir, `reviews-${tool}.json`),
    Object.fromEntries(reviewsByUrl),
  );
  return reviewsByUrl;
}

if (import.meta.main) {
  const args = parseArgs();
  const condition = (args.condition ?? "baseline") as ReviewCondition;
  if (!reviewConditions.includes(condition)) {
    throw new Error(`unknown condition: ${condition}`);
  }
  const ctx = realContext(args.model ? { reviewerModel: args.model } : {});
  const data = await loadBenchmarkData(ctx.offlineDir);
  const prs = listPrs(data, args.prs ? args.prs.split(",") : undefined);
  const reviews = await phase2Review(ctx, prs, condition);
  console.log(`Phase 2 (${condition}) complete: ${reviews.size} PR(s) reviewed as ${toolName(condition)}`);
}
