import {
  defaultJudgeModel,
  defaultReviewerModel,
  indexCacheDir,
  martianOffline,
  reviewRunsDir,
} from "./config.ts";

// Shared paths/config for a review benchmark run. Real runs point at the
// vendored Martian offline dir + repo-level caches; the smoke test points these
// at a scratch directory so it exercises the same code paths hermetically.
export type ReviewContext = {
  offlineDir: string; // dir containing results/benchmark_data.json
  indexDir: string; // Phase-1 shape index cache
  runsDir: string; // per-run artifacts
  judgeModel: string; // Martian MARTIAN_MODEL (selects results/<model>/)
  reviewerModel: string; // Codex reviewer engine
  smoke: boolean; // when true, drivers use fixtures instead of Codex/gh/shp
  timeoutMs: number;
};

export function realContext(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    offlineDir: martianOffline,
    indexDir: indexCacheDir,
    runsDir: reviewRunsDir,
    judgeModel: defaultJudgeModel,
    reviewerModel: defaultReviewerModel,
    smoke: false,
    timeoutMs: Number(Bun.env.REVIEW_TIMEOUT_MS ?? 1_800_000),
    ...overrides,
  };
}
