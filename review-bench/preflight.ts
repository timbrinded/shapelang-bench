import { exists, joinPath } from "../src/bun-utils.ts";
import { martianOffline, shpBin } from "./config.ts";

// Fail fast with remediation steps instead of a deep file-not-found. Called by
// REAL entry points only — the hermetic smoke must keep running on a fresh
// clone with no submodules.
export async function assertRealRunPrereqs(opts: { needShp?: boolean } = {}): Promise<void> {
  const problems: string[] = [];
  if (!(await exists(joinPath(martianOffline, "results", "benchmark_data.json")))) {
    problems.push(
      "Martian dataset missing — run: git submodule update --init external/code-review-benchmark",
    );
  }
  if (opts.needShp && !(await exists(shpBin))) {
    problems.push(
      "shp binary not built — run: git submodule update --init external/shapelang && bun run review:build-shp",
    );
  }
  if (problems.length > 0) {
    throw new Error(`preflight failed:\n  - ${problems.join("\n  - ")}`);
  }
}
