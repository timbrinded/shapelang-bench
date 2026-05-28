import fs from "node:fs";
import path from "node:path";
import { runsDir } from "./config.mjs";

function findEvaluations(root) {
  const results = [];
  if (!fs.existsSync(root)) return results;

  function walk(current) {
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        walk(path.join(current, entry));
      }
      return;
    }
    if (path.basename(current) === "evaluation.json" || current.endsWith("reference-l0.json") || current.endsWith("reference-l3.json")) {
      results.push(current);
    }
  }

  walk(root);
  return results;
}

const rows = findEvaluations(runsDir)
  .map((file) => {
    const result = JSON.parse(fs.readFileSync(file, "utf8"));
    const codexPath = path.join(path.dirname(file), "codex-result.json");
    const codex = fs.existsSync(codexPath)
      ? JSON.parse(fs.readFileSync(codexPath, "utf8"))
      : null;
    return {
      file: path.relative(runsDir, file),
      taskId: result.taskId ?? "commerce-ledger",
      level: result.level,
      condition: path.relative(runsDir, file).includes("-shape-") ? "shape" : "baseline",
      codexTimedOut: codex?.timedOut ?? false,
      installCode: result.install?.code ?? null,
      assertionsPassed: result.behavior.assertionsPassed,
      assertionsTotal: result.behavior.assertionsTotal,
      assertionPassRate: result.behavior.assertionPassRate,
      structurePassed: result.structure.passed,
      passed: result.passed,
      firstFailure: result.behavior.failures[0]?.name ?? "",
    };
  })
  .sort((a, b) => a.file.localeCompare(b.file));

console.table(rows);

const grouped = new Map();
for (const row of rows) {
  const key = `${row.taskId}:${row.condition}:${row.level}`;
  const current = grouped.get(key) ?? {
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
