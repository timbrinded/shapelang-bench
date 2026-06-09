import {
  exists,
  joinPath,
  readJson,
  runProcess,
  writeJson,
  type CommandResult,
} from "../src/bun-utils.ts";
import type { BenchmarkData, CandidatesFile, ReviewComment } from "./types.ts";

export function sanitizeModelName(model: string): string {
  return model.trim().replaceAll("/", "_");
}

export function modelDir(offlineDir: string, model: string): string {
  return joinPath(offlineDir, "results", sanitizeModelName(model));
}

export function benchmarkDataPath(offlineDir: string): string {
  return joinPath(offlineDir, "results", "benchmark_data.json");
}

export async function loadBenchmarkData(offlineDir: string): Promise<BenchmarkData> {
  return readJson<BenchmarkData>(benchmarkDataPath(offlineDir));
}

// Append our tool's reviews to benchmark_data (idempotent: any prior reviews for
// the same tool are dropped first). step3 iterates over benchmark_data reviews,
// so a tool must appear here to be judged. Returns the mutated data object.
export function injectTool(
  data: BenchmarkData,
  tool: string,
  reviewsByUrl: Map<string, ReviewComment[]>,
): BenchmarkData {
  for (const [goldenUrl, comments] of reviewsByUrl) {
    const entry = data[goldenUrl];
    if (!entry) continue;
    entry.reviews = (entry.reviews ?? []).filter((review) => review.tool !== tool);
    entry.reviews.push({
      tool,
      pr_url: goldenUrl,
      repo_name: entry.source_repo ?? null,
      review_comments: comments,
    });
  }
  return data;
}

// Merge our tool's candidates into a candidates.json without clobbering other
// tools already present for the same judge model.
export async function mergeCandidates(
  candidatesFile: string,
  tool: string,
  candidatesByUrl: Map<string, ReviewComment[]>,
): Promise<void> {
  const existing: CandidatesFile = (await exists(candidatesFile))
    ? await readJson<CandidatesFile>(candidatesFile)
    : {};
  for (const [goldenUrl, comments] of candidatesByUrl) {
    const byTool = existing[goldenUrl] ?? (existing[goldenUrl] = {});
    byTool[tool] = comments
      .filter((comment) => comment.body && comment.body.trim().length > 0)
      .map((comment) => ({
        text: comment.body,
        path: comment.path,
        line: comment.line,
        source: "shapelang",
      }));
  }
  await writeJson(candidatesFile, existing);
}

export type UvStep =
  | "step2_extract_comments"
  | "step2_5_dedup_candidates"
  | "step3_judge_comments";

// Run a Martian pipeline step via `uv run python -m code_review_benchmark.<step>`
// from the offline/ directory. `model` selects results/<model>/ via MARTIAN_MODEL.
// Requires MARTIAN_API_KEY in offline/.env.
export async function runUvStep(
  offlineDir: string,
  step: UvStep,
  args: string[],
  model: string,
  timeoutMs = 1_800_000,
): Promise<CommandResult> {
  return runProcess("uv", ["run", "python", "-m", `code_review_benchmark.${step}`, ...args], {
    cwd: offlineDir,
    env: { ...Bun.env, PATH: Bun.env.PATH ?? "", MARTIAN_MODEL: model },
    timeoutMs,
  });
}
