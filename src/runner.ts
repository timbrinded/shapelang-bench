import { bunBin, defaultPort } from "./config.ts";
import {
  exists,
  joinPath,
  readJson,
  readText,
  runProcess,
  writeJson,
  writeText,
} from "./bun-utils.ts";

async function copyAuth(codexHome: string): Promise<boolean> {
  const home = Bun.env.HOME;
  if (!home) return false;
  const source = joinPath(home, ".codex", "auth.json");
  if (!(await exists(source))) return false;
  await writeText(joinPath(codexHome, "auth.json"), await readText(source));
  return true;
}

export type CodexRun = {
  code: number | null;
  timedOut: boolean;
  durationMs: number;
};

// Run one Codex generation into workDir using an isolated HOME/CODEX_HOME so the
// agent cannot read the operator's real config or rules.
export async function runCodex(options: {
  cellDir: string;
  workDir: string;
  prompt: string;
  model: string;
  timeoutMs: number;
  copyAuth: boolean;
}): Promise<CodexRun> {
  const codexHome = joinPath(options.cellDir, "codex-home");
  const runHome = joinPath(options.cellDir, "home");
  await writeText(joinPath(codexHome, ".gitkeep"), "");
  await writeText(joinPath(runHome, ".gitkeep"), "");
  if (options.copyAuth) await copyAuth(codexHome);

  await writeText(joinPath(options.cellDir, "prompt.md"), options.prompt);

  const env = {
    ...Bun.env,
    HOME: runHome,
    CODEX_HOME: codexHome,
    PATH: Bun.env.PATH ?? "",
    PORT: String(defaultPort),
  };

  const codexArgs = [
    "exec",
    "--model",
    options.model,
    "--ignore-user-config",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--output-last-message",
    joinPath(options.cellDir, "last-message.txt"),
    "-C",
    options.workDir,
  ];

  const start = Date.now();
  const result = await runProcess("codex", codexArgs, {
    cwd: options.workDir,
    env,
    stdin: options.prompt,
    timeoutMs: options.timeoutMs,
  });
  const durationMs = Date.now() - start;

  await writeText(joinPath(options.cellDir, "codex-stdout.txt"), result.stdout);
  await writeText(joinPath(options.cellDir, "codex-stderr.txt"), result.stderr);
  await writeJson(joinPath(options.cellDir, "codex-result.json"), { ...result, durationMs });

  return { code: result.code, timedOut: result.timedOut, durationMs };
}

// Evaluate the candidate in workDir via the hardened evaluator subprocess and
// return the parsed evaluation result.
export async function evaluateCandidate(options: {
  workDir: string;
  taskId: string;
  level: string;
  condition: string;
  model: string;
  generation: number | null;
  outPath: string;
}): Promise<any> {
  const evalArgs = [
    joinPath(import.meta.dir, "evaluate.ts"),
    "--task",
    options.taskId,
    "--candidate",
    options.workDir,
    "--level",
    options.level,
    "--condition",
    options.condition,
    "--model",
    options.model,
    "--out",
    options.outPath,
  ];
  if (options.generation !== null) {
    evalArgs.push("--generation", String(options.generation));
  }

  const evaluator = await runProcess(bunBin, evalArgs, {
    cwd: options.workDir,
    env: { ...Bun.env, PATH: Bun.env.PATH ?? "" },
    timeoutMs: 180_000,
  });

  await writeText(joinPath(dirnameOf(options.outPath), "evaluate-stdout.txt"), evaluator.stdout);
  await writeText(joinPath(dirnameOf(options.outPath), "evaluate-stderr.txt"), evaluator.stderr);

  if (await exists(options.outPath)) {
    return readJson<any>(options.outPath);
  }
  return { failureClass: "rig_harness_exception", rigFailure: true, behavior: { assertionPassRate: 0, failures: [] }, functionalPassRate: null, evaluatorStderr: evaluator.stderr.slice(-500) };
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "." : path.slice(0, index);
}
