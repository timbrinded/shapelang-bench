import {
  bunBin,
  conditions,
  defaultModel,
  defaultPort,
  levels as allLevels,
  promptsDir,
  runsDir,
  taskIds,
} from "./config.ts";
import { defaultLanguage, languageIds } from "./languages.ts";
import {
  exists,
  joinPath,
  parseArgs,
  readText,
  runProcess,
  writeJson,
  writeText,
} from "./bun-utils.ts";

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function slugifyModel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function copyAuth(codexHome: string): Promise<boolean> {
  const home = Bun.env.HOME;
  if (!home) return false;

  const source = joinPath(home, ".codex", "auth.json");
  if (!(await exists(source))) return false;

  await writeText(joinPath(codexHome, "auth.json"), await readText(source));
  return true;
}

const args = parseArgs();
const selectedLevels = (args.levels ? args.levels.split(",") : allLevels).map((level) =>
  level.trim().toUpperCase(),
);
const trials = Number(args.trials ?? 1);
const model = args.model ?? defaultModel;
const modelSlug = slugifyModel(model);
const timeoutMs = Number(args.timeoutMs ?? 600_000);
const evaluationTimeoutMs = Number(args.evaluationTimeoutMs ?? 180_000);
const condition = args.condition ?? "baseline";
const taskId = args.task ?? "commerce-ledger";
const language = args.language ?? defaultLanguage;
const port = Number(args.port ?? defaultPort);
const healthTimeoutMs = args.healthTimeoutMs ? Number(args.healthTimeoutMs) : null;
const shouldCopyAuth = args["copy-auth"] === "true";

for (const level of selectedLevels) {
  if (!allLevels.includes(level)) {
    throw new Error(`unknown level: ${level}`);
  }
}
if (!conditions.includes(condition)) {
  throw new Error(`unknown condition: ${condition}`);
}
if (!taskIds.includes(taskId)) {
  throw new Error(`unknown task: ${taskId}`);
}
if (!languageIds.includes(language)) {
  throw new Error(`unknown language: ${language}`);
}

await writeText(joinPath(runsDir, ".gitkeep"), "");

for (const level of selectedLevels) {
  const prompt = await readText(
    joinPath(promptsDir, language, taskId, condition, `${level.toLowerCase()}.md`),
  );

  for (let trial = 1; trial <= trials; trial += 1) {
    const runDir = joinPath(
      runsDir,
      `${timestamp()}-${modelSlug}-${language}-${taskId}-${condition}-${level.toLowerCase()}-trial-${trial}`,
    );
    const workDir = joinPath(runDir, "work");
    const runHome = joinPath(runDir, "home");
    const codexHome = joinPath(runDir, "codex-home");

    await writeText(joinPath(workDir, ".gitkeep"), "");
    await writeText(joinPath(runHome, ".gitkeep"), "");
    await writeText(joinPath(codexHome, ".gitkeep"), "");
    if (shouldCopyAuth) {
      await copyAuth(codexHome);
    }

    await writeText(joinPath(runDir, "prompt.md"), prompt);
    await writeJson(joinPath(runDir, "run.json"), {
      model,
      modelSlug,
      language,
      taskId,
      condition,
      level,
      trial,
      createdAt: new Date().toISOString(),
    });

    const env = {
      ...Bun.env,
      HOME: runHome,
      CODEX_HOME: codexHome,
      PATH: Bun.env.PATH ?? "",
      PORT: String(port),
    };

    const codexArgs = [
      "exec",
      "--model",
      model,
      "--ignore-user-config",
      "--ignore-rules",
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "--output-last-message",
      joinPath(runDir, "last-message.txt"),
      "-C",
      workDir,
    ];

    console.log(
      `running Codex ${language} ${taskId} ${condition} ${level} trial ${trial} with ${model}`,
    );
    const codex = await runProcess("codex", codexArgs, {
      cwd: workDir,
      env,
      stdin: prompt,
      timeoutMs,
    });

    await writeText(joinPath(runDir, "codex-stdout.txt"), codex.stdout);
    await writeText(joinPath(runDir, "codex-stderr.txt"), codex.stderr);
    await writeJson(joinPath(runDir, "codex-result.json"), codex);

    const evalOut = joinPath(runDir, "evaluation.json");
    const evaluator = await runProcess(
      bunBin,
      [
        joinPath(import.meta.dir, "evaluate.ts"),
        "--model",
        model,
        "--language",
        language,
        "--task",
        taskId,
        "--condition",
        condition,
        "--candidate",
        workDir,
        "--level",
        level,
        "--port",
        String(port),
        ...(healthTimeoutMs === null ? [] : ["--healthTimeoutMs", String(healthTimeoutMs)]),
        "--out",
        evalOut,
      ],
      {
        cwd: workDir,
        env: {
          ...Bun.env,
          PATH: Bun.env.PATH ?? "",
        },
        timeoutMs: evaluationTimeoutMs,
      },
    );

    await writeText(joinPath(runDir, "evaluate-stdout.txt"), evaluator.stdout);
    await writeText(joinPath(runDir, "evaluate-stderr.txt"), evaluator.stderr);
    console.log(evaluator.stdout.trim());
  }
}
