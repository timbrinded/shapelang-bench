import { joinPath, pathFromImport } from "./bun-utils.ts";
import { defaultLanguage, languageProfiles, shapeGuidanceForLanguage } from "./languages.ts";

export const harnessDir = pathFromImport(import.meta.url, "..");

export const repoRoot = harnessDir;
export const promptsDir = joinPath(harnessDir, "prompts");
export const runsDir = joinPath(harnessDir, "runs");
export const tasksDir = joinPath(harnessDir, "tasks");
export const defaultPort = 3137;
export const bunBin = Bun.env.BUN_BIN ?? "bun";
export const defaultModel = "gpt-5.4-mini";

export const levels = ["L0", "L1", "L2", "L3"];
export const conditions = ["baseline", "shape"];
export const taskIds = [
  "commerce-ledger",
  "coupon-redemptions",
  "grant-budgets",
  "seat-reservations",
  "rebate-claims",
  "stipend-awards",
  "work-queue-leases",
];

export const constraintBlocks = languageProfiles[defaultLanguage].constraintBlocks;
export const shapeGuidance = shapeGuidanceForLanguage(defaultLanguage);
