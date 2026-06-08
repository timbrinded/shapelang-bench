import { joinPath, pathFromImport } from "../bun-utils.ts";

// src/review/config.ts -> repo root is two directories up.
export const repoRoot = pathFromImport(import.meta.url, "../..");

export const externalDir = joinPath(repoRoot, "external");
export const martianRoot = joinPath(externalDir, "code-review-benchmark");
export const martianOffline = joinPath(martianRoot, "offline");
export const shapelangRoot = joinPath(externalDir, "shapelang");
// `shp` is the self-contained binary built from the shapelang branch by
// scripts/build-shp.sh (bundled tree-sitter parsers; works offline, no env).
export const shpBin = joinPath(externalDir, "shp-build", "shp");
export const shapelangSkillDir = joinPath(shapelangRoot, "skill", "shape-lang");

export const skillsDir = joinPath(repoRoot, "skills");
export const indexCacheDir = joinPath(repoRoot, "index");
export const reviewRunsDir = joinPath(repoRoot, "runs", "review");
export const smokeFixturesDir = joinPath(repoRoot, "fixtures", "review-smoke");

export const bunBin = Bun.env.BUN_BIN ?? "bun";

export const reviewConditions = ["baseline", "shape"] as const;
export type ReviewCondition = (typeof reviewConditions)[number];

// Martian "tool" name our reviewer registers as, per condition (and trial, for
// repeated-trial runs). These appear alongside the published tools in evaluations.json.
export function toolName(condition: ReviewCondition, trial?: number): string {
  return trial ? `shapelang-${condition}-t${trial}` : `shapelang-${condition}`;
}

// The judge model. With the default `codex` backend this is a Codex model run
// on the subscription (no API key); results land in results/<sanitized-model>/.
// For the `martian` backend, pass a Martian model name (e.g. openai/gpt-5.2) so
// scores sit beside the published ones for that judge.
export const defaultJudgeModel = Bun.env.JUDGE_MODEL ?? "gpt-5.5";

// The reviewer engine (Codex). gpt-5.2 was retired for ChatGPT-account Codex
// (400 "model is not supported"); gpt-5.5 is the account default that works. The
// FIXED baseline must be (re)scored with the SAME reviewer as the variants so the
// shape−baseline delta stays pure Shape and not a model artifact.
export const defaultReviewerModel = Bun.env.REVIEW_MODEL ?? "gpt-5.5";
