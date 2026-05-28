import { runsDir, taskIds } from "./config.ts";
import { basename, listFiles, modifiedTime, readJson, relativePath } from "./bun-utils.ts";
import { defaultLanguage, languageIds } from "./languages.ts";

async function walkEvaluations(root: string): Promise<string[]> {
  return (await listFiles(root)).filter((file) => basename(file) === "evaluation.json");
}

function conditionForFile(file: string): "shape" | "baseline" {
  return relativePath(runsDir, file).includes("-shape-") ? "shape" : "baseline";
}

async function latestByTaskConditionLevel(files: string[]) {
  const latest = new Map<string, { file: string; result: any; mtimeMs: number }>();

  for (const file of files) {
    const result = await readJson<any>(file);
    const language = result.language ?? defaultLanguage;
    const taskId = result.taskId ?? "commerce-ledger";
    const key = `${language}:${taskId}:${conditionForFile(file)}:${result.level}`;
    const previous = latest.get(key);
    const mtimeMs = await modifiedTime(file);
    if (!previous || previous.mtimeMs < mtimeMs) {
      latest.set(key, { file, result, mtimeMs });
    }
  }

  return latest;
}

const latest = await latestByTaskConditionLevel(await walkEvaluations(runsDir));

const rows = languageIds.flatMap((language) => taskIds.map((taskId) => {
  const l0 = latest.get(`${language}:${taskId}:baseline:L0`)?.result ?? null;
  const l3 = latest.get(`${language}:${taskId}:baseline:L3`)?.result ?? null;
  const shapeL3 = latest.get(`${language}:${taskId}:shape:L3`)?.result ?? null;
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
    language,
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
}));

console.table(rows);

const accepted = rows.filter((row) => row.showsDecay);
console.log(
  JSON.stringify(
    {
      acceptedTasks: accepted.map((row) => row.taskId),
      acceptedByLanguage: accepted.map((row) => `${row.language}:${row.taskId}`),
      acceptedCount: accepted.length,
      targetCount: taskIds.length * languageIds.length,
      readyForShapeComparison: accepted.length === taskIds.length * languageIds.length,
    },
    null,
    2,
  ),
);
