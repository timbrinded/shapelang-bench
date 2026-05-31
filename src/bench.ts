import {
  conditions as allConditions,
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
import { evaluateCandidate, runCodex, seedWork } from "./runner.ts";

// Corrected apparatus (the experiment the benchmark is for):
//   Question: does successive-generation LLM code generation degrade conformance
//   to the ORIGINAL spec as feature bloat accumulates, and does ShapeLang slow it?
//   - gen 0 builds the original spec.
//   - gen k>0 adds the k-th NEW feature on top of gen k-1's code (additive bloat;
//     the agent is NOT told to preserve behavior and is NOT re-shown the original
//     spec — it works from the code plus a feature ticket).
//   - EVERY generation is scored against the ORIGINAL blind oracle, so the metric
//     is conformance to the original spec over generations.
//   Conditions: `control` (vanilla agent, spec only) vs `shapelang` (same agent
//   told to use the ShapeLang skill). Codex runs with an isolated CODEX_HOME, so
//   the control cannot discover the skill.

const args = parseArgs();
const experiment = args.experiment ?? "decay";
const model = args.model ?? "gpt-5.3-codex-spark";
const trials = Number(args.trials ?? 5);
const concurrency = Number(args.concurrency ?? 2);
const codexTimeoutMs = Number(args.timeoutMs ?? 600_000);
const copyAuth = (args["copy-auth"] ?? "true") === "true";

const taskIds = (args.tasks ? args.tasks.split(",") : allTaskIds).map((t) => t.trim());
const conditions = (args.conditions ? args.conditions.split(",") : allConditions).map((c) => c.trim());

for (const t of taskIds) if (!allTaskIds.includes(t)) throw new Error(`unknown task: ${t}`);
for (const c of conditions) if (!allConditions.includes(c)) throw new Error(`unknown condition: ${c}`);

const expRoot = joinPath(runsDir, experiment);
const template = await readText(joinPath(promptsDir, "template.md"));

type Feature = { title: string; instruction: string };

async function loadFeatures(taskId: string): Promise<Feature[]> {
  const path = joinPath(tasksDir, taskId, "features.json");
  if (!(await exists(path))) return [];
  return readJson<Feature[]>(path);
}

// gen 0: build the original spec. The structural-constraints slot is empty for
// `control` and carries the ShapeLang instruction for `shapelang`.
async function buildGen0Prompt(taskId: string, condition: string): Promise<string> {
  const openApi = await readText(joinPath(tasksDir, taskId, "openapi.yaml"));
  const details = await readText(joinPath(tasksDir, taskId, "details.md"));
  const guidance = condition === "shapelang" ? shapelangInstruction.trim() : "";
  return template
    .replace("{{OPENAPI}}", `\`\`\`yaml\n${openApi.trim()}\n\`\`\``)
    .replace("{{CONSTRAINTS}}", guidance)
    .replace("{{TASK_DETAILS}}", details.trim());
}

// gen k>0: a feature ticket against the existing code. Deliberately does NOT
// re-show the original spec and does NOT ask to preserve behavior — that is the
// whole point (does original conformance silently rot under feature bloat?).
function buildFeaturePrompt(condition: string, feature: Feature): string {
  const guidance =
    condition === "shapelang"
      ? `\n\n${shapelangInstruction.trim()}\n\nFor THIS change: consult your Shape model first, update \`shape/*.shape\` to reflect the change, and re-run \`shp check\` before finishing.`
      : "";
  return `# Feature request for an existing service

An existing Node.js/Express service is already in the current working directory.
It installs with \`bun install\` and starts with \`bun run start\`, and
\`GET /api/health-check\` returns 200. Implement the following change on top of it.

## Change request: ${feature.title}

${feature.instruction}

## Constraints

- Work only in the current directory; keep using \`express\` and the existing
  \`start\` script (Bun). The server must still listen on \`process.env.PORT\`
  (default 3137) with all routes under \`/api\`.
- After your change, the service must still \`bun install\` and \`bun run start\`
  cleanly.${guidance}

Finish only when the service is ready to run.`;
}

type CellResult = {
  taskId: string;
  condition: string;
  generation: number;
  trial: number;
  functionalPassRate: number | null;
  failureClass: string;
  rigFailure: boolean;
  shapeConformant: boolean | null;
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

function summarize(
  taskId: string,
  condition: string,
  generation: number,
  trial: number,
  evaluation: any,
  codexTimedOut: boolean,
  skipped: boolean,
): CellResult {
  return {
    taskId,
    condition,
    generation,
    trial,
    functionalPassRate: evaluation?.functionalPassRate ?? null,
    failureClass: evaluation?.failureClass ?? "unknown",
    rigFailure: evaluation?.rigFailure ?? true,
    shapeConformant: evaluation?.structure?.shape?.conformant ?? null,
    codexTimedOut,
    skipped,
  };
}

async function writeRunnerFailure(
  evalPath: string,
  taskId: string,
  condition: string,
  generation: number,
  reason: string,
): Promise<any> {
  const record = {
    taskId,
    condition,
    model,
    level: "L0",
    generation,
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

// One generation chain for a (task, condition, trial). gen 0 builds the spec;
// gen k>0 adds feature[k-1]. Every generation is scored against the original
// oracle (level L0 — we measure original-spec behavior, not architecture).
async function runChain(taskId: string, condition: string, trial: number): Promise<CellResult[]> {
  const features = await loadFeatures(taskId);
  const generations = features.length + 1;
  const results: CellResult[] = [];
  const chainDir = joinPath(expRoot, taskId, condition, model, `trial-${trial}`);

  let previousWork: string | null = null;
  for (let gen = 0; gen < generations; gen += 1) {
    const cellDir = joinPath(chainDir, `gen-${gen}`);
    const evalPath = joinPath(cellDir, "evaluation.json");
    const workDir = joinPath(cellDir, "work");

    const existing = await loadEvaluation(evalPath);
    if (isComplete(existing)) {
      results.push(summarize(taskId, condition, gen, trial, existing, false, true));
      previousWork = workDir;
      continue;
    }

    await removePath(workDir);
    await writeText(joinPath(workDir, ".gitkeep"), "");

    let prompt: string;
    if (gen === 0) {
      prompt = await buildGen0Prompt(taskId, condition);
    } else {
      if (previousWork && (await exists(previousWork))) {
        await seedWork(workDir, previousWork);
        prompt = buildFeaturePrompt(condition, features[gen - 1]);
      } else {
        // Prior generation missing (resumed partial run): cannot fairly continue
        // the bloat chain, so rebuild gen 0 here.
        prompt = await buildGen0Prompt(taskId, condition);
      }
    }

    const codex = await runCodex({ cellDir, workDir, prompt, model, timeoutMs: codexTimeoutMs, copyAuth });
    const runnerFail = await detectRunnerFailure(codex, workDir);
    if (runnerFail) {
      const rec = await writeRunnerFailure(evalPath, taskId, condition, gen, runnerFail);
      results.push(summarize(taskId, condition, gen, trial, rec, codex.timedOut, false));
      break; // leave the rest of the chain for a resumable wave
    }

    const evaluation = await evaluateCandidate({
      workDir,
      taskId,
      level: "L0", // measure original-spec behavior; architecture is not graded here
      condition,
      model,
      generation: gen,
      outPath: evalPath,
    });
    results.push(summarize(taskId, condition, gen, trial, evaluation, codex.timedOut, false));
    previousWork = workDir;
  }
  return results;
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

// Dry run: print the exact prompts each arm receives and exit (no Codex). Lets
// you verify the control contains zero Shape mention before spending budget.
if (args["dry-run"] === "true") {
  for (const taskId of taskIds) {
    const features = await loadFeatures(taskId);
    for (const condition of conditions) {
      console.log(`\n########## ${taskId} / ${condition} / gen 0 ##########\n`);
      console.log(await buildGen0Prompt(taskId, condition));
      if (features.length) {
        console.log(`\n########## ${taskId} / ${condition} / gen 1 (feature: ${features[0].title}) ##########\n`);
        console.log(buildFeaturePrompt(condition, features[0]));
      }
    }
  }
  console.log(`\n[dry-run] ${taskIds.length} task(s) x ${conditions.join("/")} ; ${(await loadFeatures(taskIds[0])).length + 1} generations each`);
  process.exit(0);
}

await writeText(joinPath(runsDir, ".gitkeep"), "");

// Trial-major ordering so an interrupted run still yields >=1 trial per chain.
const units: Array<() => Promise<CellResult[]>> = [];
for (let trial = 1; trial <= trials; trial += 1) {
  for (const taskId of taskIds) {
    for (const condition of conditions) {
      const t = trial;
      units.push(() => runChain(taskId, condition, t));
    }
  }
}

console.log(
  `bench(decay): experiment=${experiment} model=${model} tasks=${taskIds.length} conditions=${conditions.join("/")} trials=${trials} chains=${units.length} concurrency=${concurrency}`,
);

let done = 0;
const flat = await pool(
  units,
  async (unit) => {
    const out = await unit();
    done += 1;
    for (const c of out) {
      console.log(
        `[${done}/${units.length}] ${c.taskId} ${c.condition} gen${c.generation} t${c.trial} -> ${c.failureClass} origConformance=${c.functionalPassRate ?? "n/a"} shape=${c.shapeConformant ?? "n/a"}${c.skipped ? " (cached)" : ""}`,
      );
    }
    return out;
  },
  concurrency,
);

const cells = flat.flat();
const manifestPath = joinPath(expRoot, "manifest.json");
await writeJson(manifestPath, {
  experiment,
  model,
  taskIds,
  conditions,
  trials,
  generatedAt: new Date().toISOString(),
  cells,
});
console.log(`\nwrote ${cells.length} cells to ${manifestPath}`);
