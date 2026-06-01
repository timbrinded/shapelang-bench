import {
  conditions as allConditions,
  constraintBlocks,
  levels as allLevels,
  promptsDir,
  runsDir,
  shapelangInstruction,
  taskIds as allTaskIds,
  tasksDir,
} from "./config.ts";
import {
  exists,
  joinPath,
  parseArgs,
  readJson,
  readText,
  removePath,
  writeJson,
  writeText,
} from "./bun-utils.ts";
import { evaluateCandidate, runCodex } from "./runner.ts";

// Replication of the paper's constraint-decay experiment (Dente et al.) with a
// ShapeLang intervention:
//   - Fixed API contract per task, blind behavioral oracle the agent never sees.
//   - Each (task, condition, level) is a single 0-shot generation under an
//     increasing structural-constraint ladder (L0 -> L3).
//   - Dual evaluation: behavioral Assert% AND static architecture/DB/ORM
//     verifiers (the paper's two axes), plus shp conformance for the shapelang arm.
//   - Conditions: `control` (vanilla agent, skills isolated) vs `shapelang` (same
//     agent told to use the ShapeLang skill). Decay = L0->L3 drop; the question is
//     whether shapelang reduces it / lifts structural compliance.

const args = parseArgs();
const experiment = args.experiment ?? "decay";
const model = args.model ?? "gpt-5.3-codex-spark";
const trials = Number(args.trials ?? 5);
const concurrency = Number(args.concurrency ?? 2);
const codexTimeoutMs = Number(args.timeoutMs ?? 900_000);
const copyAuth = (args["copy-auth"] ?? "true") === "true";

const taskIds = (args.tasks ? args.tasks.split(",") : allTaskIds).map((t) => t.trim());
const conditions = (args.conditions ? args.conditions.split(",") : allConditions).map((c) => c.trim());
const levels = (args.levels ? args.levels.split(",") : allLevels).map((l) => l.trim().toUpperCase());

for (const t of taskIds) if (!allTaskIds.includes(t)) throw new Error(`unknown task: ${t}`);
for (const c of conditions) if (!allConditions.includes(c)) throw new Error(`unknown condition: ${c}`);
for (const l of levels) if (!allLevels.includes(l)) throw new Error(`unknown level: ${l}`);

const expRoot = joinPath(runsDir, experiment);
const template = await readText(joinPath(promptsDir, "template.md"));

async function buildPrompt(taskId: string, condition: string, level: string): Promise<string> {
  const openApi = await readText(joinPath(tasksDir, taskId, "openapi.yaml"));
  const details = await readText(joinPath(tasksDir, taskId, "details.md"));
  const constraints = constraintBlocks[level].trim();
  const guidance = condition === "shapelang" ? `\n\n${shapelangInstruction.trim()}` : "";
  return template
    .replace("{{OPENAPI}}", `\`\`\`yaml\n${openApi.trim()}\n\`\`\``)
    .replace("{{CONSTRAINTS}}", `${constraints}${guidance}`)
    .replace("{{TASK_DETAILS}}", details.trim());
}

type CellResult = {
  taskId: string;
  condition: string;
  level: string;
  trial: number;
  assertPassRate: number | null; // behavioral Assert% (rig failures -> null)
  failureClass: string;
  rigFailure: boolean;
  structurePassed: boolean | null; // architecture/DB/ORM verifiers
  shapeConformant: boolean | null; // shp check on the agent's .shape (shapelang)
  codexTimedOut: boolean;
  skipped: boolean;
};

function isComplete(evaluation: any): boolean {
  return Boolean(evaluation) && typeof evaluation.failureClass === "string" && !evaluation.rigFailure;
}

async function loadEvaluation(path: string): Promise<any | null> {
  if (!(await exists(path))) return null;
  try {
    return await readJson<any>(path);
  } catch {
    return null;
  }
}

async function detectRunnerFailure(
  codex: { code: number | null; timedOut: boolean },
  workDir: string,
): Promise<string | null> {
  if (codex.timedOut) return "rig_runner_timeout";
  if (codex.code !== 0) return `rig_runner_exit_${codex.code}`;
  if (!(await exists(joinPath(workDir, "package.json")))) return "rig_runner_no_output";
  return null;
}

async function writeRunnerFailure(
  evalPath: string,
  taskId: string,
  condition: string,
  level: string,
  reason: string,
): Promise<any> {
  const record = {
    taskId,
    condition,
    model,
    level,
    generation: null,
    failureClass: reason,
    rigFailure: true,
    functionalPassRate: null,
    behavior: { assertionsPassed: 0, assertionsTotal: 0, assertionPassRate: 0, failures: [{ name: reason, detail: "codex runner failure" }] },
    structure: { passed: false, shape: { conformant: null } },
    passed: false,
    evaluatedAt: new Date().toISOString(),
  };
  await writeJson(evalPath, record);
  return record;
}

function summarize(
  taskId: string,
  condition: string,
  level: string,
  trial: number,
  evaluation: any,
  codexTimedOut: boolean,
  skipped: boolean,
): CellResult {
  return {
    taskId,
    condition,
    level,
    trial,
    assertPassRate: evaluation?.functionalPassRate ?? null,
    failureClass: evaluation?.failureClass ?? "unknown",
    rigFailure: evaluation?.rigFailure ?? true,
    structurePassed: evaluation?.structure?.passed ?? null,
    shapeConformant: evaluation?.structure?.shape?.conformant ?? null,
    codexTimedOut,
    skipped,
  };
}

// One 0-shot cell: generate once from the level prompt, evaluate at that level.
async function runCell(taskId: string, condition: string, level: string, trial: number): Promise<CellResult> {
  const cellDir = joinPath(expRoot, taskId, condition, model, level, `trial-${trial}`);
  const evalPath = joinPath(cellDir, "evaluation.json");

  const existing = await loadEvaluation(evalPath);
  if (isComplete(existing)) {
    return summarize(taskId, condition, level, trial, existing, false, true);
  }

  const workDir = joinPath(cellDir, "work");
  await removePath(workDir);
  await writeText(joinPath(workDir, ".gitkeep"), "");

  const prompt = await buildPrompt(taskId, condition, level);
  const codex = await runCodex({ cellDir, workDir, prompt, model, timeoutMs: codexTimeoutMs, copyAuth });

  const runnerFail = await detectRunnerFailure(codex, workDir);
  if (runnerFail) {
    const rec = await writeRunnerFailure(evalPath, taskId, condition, level, runnerFail);
    return summarize(taskId, condition, level, trial, rec, codex.timedOut, false);
  }

  const evaluation = await evaluateCandidate({
    workDir,
    taskId,
    level,
    condition,
    model,
    generation: null,
    outPath: evalPath,
  });
  return summarize(taskId, condition, level, trial, evaluation, codex.timedOut, false);
}

async function pool<T, R>(items: T[], worker: (item: T) => Promise<R>, limit: number): Promise<R[]> {
  const queue = items.map((item, index) => ({ item, index }));
  const results: R[] = new Array(items.length);
  async function drain() {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      results[next.index] = await worker(next.item);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, drain));
  return results;
}

await writeText(joinPath(runsDir, ".gitkeep"), "");

if (args["dry-run"] === "true") {
  for (const taskId of taskIds) {
    for (const condition of conditions) {
      for (const level of levels) {
        console.log(`\n########## ${taskId} / ${condition} / ${level} ##########\n`);
        console.log(await buildPrompt(taskId, condition, level));
      }
    }
  }
  process.exit(0);
}

// Trial-major ordering so an interrupted run still yields >=1 trial per cell.
const units: Array<() => Promise<CellResult>> = [];
for (let trial = 1; trial <= trials; trial += 1) {
  for (const taskId of taskIds) {
    for (const condition of conditions) {
      for (const level of levels) {
        const t = trial;
        units.push(() => runCell(taskId, condition, level, t));
      }
    }
  }
}

console.log(
  `bench(constraint-decay): experiment=${experiment} model=${model} tasks=${taskIds.length} conditions=${conditions.join("/")} levels=${levels.join("/")} trials=${trials} cells=${units.length} concurrency=${concurrency}`,
);

let done = 0;
const cells = await pool(
  units,
  async (unit) => {
    const c = await unit();
    done += 1;
    console.log(
      `[${done}/${units.length}] ${c.taskId} ${c.condition} ${c.level} t${c.trial} -> ${c.failureClass} assert=${c.assertPassRate ?? "n/a"} struct=${c.structurePassed ?? "n/a"} shape=${c.shapeConformant ?? "n/a"}${c.skipped ? " (cached)" : ""}`,
    );
    return c;
  },
  concurrency,
);

const manifestPath = joinPath(expRoot, "manifest.json");
await writeJson(manifestPath, {
  experiment,
  model,
  taskIds,
  conditions,
  levels,
  trials,
  generatedAt: new Date().toISOString(),
  cells,
});
console.log(`\nwrote ${cells.length} cells to ${manifestPath}`);
