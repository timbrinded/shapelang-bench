import { basename } from "./bun-utils.ts";

// Agent-side package artifacts that must never reach the evaluation copy:
// reusing a candidate's lockfile/env/db contaminated results once before
// (the rebate-claims incident — see EXPERIMENTS.md "Harness hygiene check").
export const ignoredPackageArtifacts = new Set([
  ".env",
  ".npmrc",
  "bun.lock",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

export function shouldCopy(relative: string): boolean {
  const parts = relative.split("/");
  if (parts.includes("node_modules") || parts.includes(".git")) return false;
  if (ignoredPackageArtifacts.has(basename(relative))) return false;
  if (/\.(sqlite|sqlite-shm|sqlite-wal|db)$/.test(relative)) return false;
  return true;
}
