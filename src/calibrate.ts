import { runsDir, taskIds } from "./config.ts";
import { exists, joinPath, modifiedTime, parseArgs, readJson, relativePath } from "./bun-utils.ts";
import { defaultLanguage, languageIds } from "./languages.ts";

async function walkEvaluations(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];

  const files: string[] = [];
  for await (const relative of new Bun.Glob("*/evaluation.json").scan({ cwd: root, dot: true })) {
    files.push(joinPath(root, String(relative)));
  }
  return files.sort();
}

function conditionForFile(file: string): "shape" | "baseline" {
  return relativePath(runsDir, file).includes("-shape-") ? "shape" : "baseline";
}

function resultPhase(result: any): "install" | "startup" | "behavior" | "unknown" {
  if (!result) return "unknown";
  if (result.phase) return result.phase;
  if (result.install?.code !== 0 || result.install?.timedOut) return "install";
  if (!result.healthReady) return "startup";
  return "behavior";
}

function assertionRate(result: any): number | null {
  if (!result || result.behavior?.assertionsTotal === 0) return null;
  return result.behavior.assertionPassRate ?? null;
}

async function latestByTaskConditionLevel(files: string[], selectedModel: string | null) {
  const latest = new Map<string, { file: string; result: any; mtimeMs: number }>();

  for (const file of files) {
    const result = await readJson<any>(file);
    if (selectedModel && result.model !== selectedModel) continue;

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

const args = parseArgs();
const selectedModel = args.model ?? null;
const latest = await latestByTaskConditionLevel(await walkEvaluations(runsDir), selectedModel);

const rows = languageIds.flatMap((language) => taskIds.map((taskId) => {
  const l0 = latest.get(`${language}:${taskId}:baseline:L0`)?.result ?? null;
  const l3 = latest.get(`${language}:${taskId}:baseline:L3`)?.result ?? null;
  const shapeL3 = latest.get(`${language}:${taskId}:shape:L3`)?.result ?? null;
  const l0Phase = resultPhase(l0);
  const l3Phase = resultPhase(l3);
  const shapePhase = resultPhase(shapeL3);
  const l0Rate = assertionRate(l0);
  const l3Rate = assertionRate(l3);
  const shapeRate = assertionRate(shapeL3);
  const hasCleanControl = Boolean(l0?.passed || (l0Rate !== null && l0Rate >= 0.98));
  const showsSetupDecay = Boolean(
    hasCleanControl &&
      l3 !== null &&
      l3Phase !== "behavior" &&
      !l3?.passed,
  );
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
  const showsDecay = showsSetupDecay || showsBehaviorDecay || showsStructureDecay;

  let shapeEffect = "untested";
  if (showsDecay && shapeRate !== null) {
    const baselineFullPass = Boolean(l3?.passed);
    const shapeFullPass = Boolean(shapeL3?.passed);
    if (shapeFullPass && !baselineFullPass) shapeEffect = "better";
    else if (!shapeFullPass && baselineFullPass) shapeEffect = "worse";
    else if (l3Phase !== "behavior" && shapePhase === "behavior") shapeEffect = "better";
    else if (l3Phase === "behavior" && shapePhase !== "behavior") shapeEffect = "worse";
    else if (shapeRate > l3Rate) shapeEffect = "better";
    else if (shapeRate < l3Rate) shapeEffect = "worse";
    else shapeEffect = "same";
  } else if (showsDecay && shapeL3 !== null) {
    shapeEffect = l3Phase === shapePhase ? "same" : "worse";
  }

  return {
    model: selectedModel ?? l0?.model ?? l3?.model ?? shapeL3?.model ?? "unknown",
    language,
    taskId,
    baselineL0Phase: l0Phase,
    baselineL0: l0Rate,
    baselineL0Passed: l0?.passed ?? null,
    baselineL3Phase: l3Phase,
    baselineL3: l3Rate,
    baselineL3Passed: l3?.passed ?? null,
    shapeL3Phase: shapePhase,
    shapeL3: shapeRate,
    shapeL3Passed: shapeL3?.passed ?? null,
    cleanControl: hasCleanControl,
    decayMode: showsSetupDecay ? l3Phase : showsBehaviorDecay ? "behavior" : showsStructureDecay ? "structure" : "",
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
      model: selectedModel ?? "latest",
      targetCount: taskIds.length * languageIds.length,
      readyForShapeComparison: accepted.length === taskIds.length * languageIds.length,
    },
    null,
    2,
  ),
);
