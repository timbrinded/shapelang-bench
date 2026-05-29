import { runsDir } from "./config.ts";
import {
  basename,
  dirname,
  joinPath,
  listFiles,
  parseArgs,
  readJson,
  relativePath,
} from "./bun-utils.ts";

async function findEvaluations(root: string): Promise<string[]> {
  return (await listFiles(root)).filter((file) => {
    const name = basename(file);
    return name === "evaluation.json" || name === "reference-l0.json" || name === "reference-l3.json";
  });
}

const args = parseArgs();
const selectedModel = args.model ?? null;

const rows = (
  await Promise.all(
    (await findEvaluations(runsDir)).map(async (file) => {
      const result = await readJson<any>(file);
      const model = result.model ?? "unknown";
      if (selectedModel && model !== selectedModel) return null;

      const codexPath = joinPath(dirname(file), "codex-result.json");
      const codex = (await Bun.file(codexPath).exists()) ? await readJson<any>(codexPath) : null;
      const relative = relativePath(runsDir, file);

      return {
        file: relative,
        model,
        language: result.language ?? "javascript",
        taskId: result.taskId ?? "commerce-ledger",
        level: result.level,
        condition: relative.includes("-shape-") ? "shape" : "baseline",
        codexTimedOut: codex?.timedOut ?? false,
        installCode: result.install?.code ?? null,
        assertionsPassed: result.behavior.assertionsPassed,
        assertionsTotal: result.behavior.assertionsTotal,
        assertionPassRate: result.behavior.assertionPassRate,
        structurePassed: result.structure.passed,
        passed: result.passed,
        firstFailure: result.behavior.failures[0]?.name ?? "",
      };
    }),
  )
)
  .filter((row) => row !== null)
  .sort((a, b) => a.file.localeCompare(b.file));

console.table(rows);

const grouped = new Map<string, any>();
for (const row of rows) {
  const key = `${row.model}:${row.language}:${row.taskId}:${row.condition}:${row.level}`;
  const current = grouped.get(key) ?? {
    model: row.model,
    language: row.language,
    taskId: row.taskId,
    condition: row.condition,
    level: row.level,
    runs: 0,
    codexTimeouts: 0,
    installFailures: 0,
    assertionPassRate: 0,
    passCount: 0,
    structurePassCount: 0,
  };
  current.runs += 1;
  current.codexTimeouts += row.codexTimedOut ? 1 : 0;
  current.installFailures += row.installCode === 0 ? 0 : 1;
  current.assertionPassRate += row.assertionPassRate;
  current.passCount += row.passed ? 1 : 0;
  current.structurePassCount += row.structurePassed ? 1 : 0;
  grouped.set(key, current);
}

const summary = [...grouped.values()].map((row) => ({
  taskId: row.taskId,
  model: row.model,
  language: row.language,
  condition: row.condition,
  level: row.level,
  runs: row.runs,
  codexTimeouts: row.codexTimeouts,
  installFailures: row.installFailures,
  avgAssertionPassRate: row.assertionPassRate / row.runs,
  passRate: row.passCount / row.runs,
  structurePassRate: row.structurePassCount / row.runs,
}));

console.table(summary);
