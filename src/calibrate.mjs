import fs from "node:fs";
import path from "node:path";
import { runsDir, taskIds } from "./config.mjs";

function walkEvaluations(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;

  function walk(current) {
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        walk(path.join(current, entry));
      }
      return;
    }
    if (path.basename(current) === "evaluation.json") files.push(current);
  }

  walk(root);
  return files;
}

function conditionForFile(file) {
  return path.relative(runsDir, file).includes("-shape-") ? "shape" : "baseline";
}

function latestByTaskConditionLevel(files) {
  const latest = new Map();

  for (const file of files) {
    const result = JSON.parse(fs.readFileSync(file, "utf8"));
    const taskId = result.taskId ?? "commerce-ledger";
    const key = `${taskId}:${conditionForFile(file)}:${result.level}`;
    const previous = latest.get(key);
    const mtimeMs = fs.statSync(file).mtimeMs;
    if (!previous || previous.mtimeMs < mtimeMs) {
      latest.set(key, { file, result, mtimeMs });
    }
  }

  return latest;
}

const latest = latestByTaskConditionLevel(walkEvaluations(runsDir));

const rows = taskIds.map((taskId) => {
  const l0 = latest.get(`${taskId}:baseline:L0`)?.result ?? null;
  const l3 = latest.get(`${taskId}:baseline:L3`)?.result ?? null;
  const shapeL3 = latest.get(`${taskId}:shape:L3`)?.result ?? null;
  const l0Rate = l0?.behavior.assertionPassRate ?? null;
  const l3Rate = l3?.behavior.assertionPassRate ?? null;
  const shapeRate = shapeL3?.behavior.assertionPassRate ?? null;
  const hasCleanControl = Boolean(l0?.passed || (l0Rate !== null && l0Rate >= 0.98));
  const showsBehaviorDecay = Boolean(
    hasCleanControl &&
      l3Rate !== null &&
      l0Rate !== null &&
      l3Rate < l0Rate &&
      !l3?.passed,
  );
  const showsStructureDecay = Boolean(
    hasCleanControl &&
      l3 !== null &&
      l3Rate !== null &&
      l3Rate >= 0.98 &&
      !l3.structure.passed,
  );
  const showsDecay = showsBehaviorDecay || showsStructureDecay;

  let shapeEffect = "untested";
  if (showsDecay && shapeRate !== null) {
    const baselineFullPass = Boolean(l3?.passed);
    const shapeFullPass = Boolean(shapeL3?.passed);
    if (shapeFullPass && !baselineFullPass) shapeEffect = "better";
    else if (!shapeFullPass && baselineFullPass) shapeEffect = "worse";
    else if (shapeRate > l3Rate) shapeEffect = "better";
    else if (shapeRate < l3Rate) shapeEffect = "worse";
    else shapeEffect = "same";
  }

  return {
    taskId,
    baselineL0: l0Rate,
    baselineL0Passed: l0?.passed ?? null,
    baselineL3: l3Rate,
    baselineL3Passed: l3?.passed ?? null,
    shapeL3: shapeRate,
    shapeL3Passed: shapeL3?.passed ?? null,
    cleanControl: hasCleanControl,
    decayMode: showsBehaviorDecay ? "behavior" : showsStructureDecay ? "structure" : "",
    showsDecay,
    shapeEffect,
    l0FirstFailure: l0?.behavior.failures[0]?.name ?? "",
    l3FirstFailure: l3?.behavior.failures[0]?.name ?? "",
  };
});

console.table(rows);

const accepted = rows.filter((row) => row.showsDecay);
console.log(
  JSON.stringify(
    {
      acceptedTasks: accepted.map((row) => row.taskId),
      acceptedCount: accepted.length,
      targetCount: taskIds.length,
      readyForShapeComparison: accepted.length === taskIds.length,
    },
    null,
    2,
  ),
);
