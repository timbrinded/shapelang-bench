import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  bunBin,
  conditions,
  defaultPort,
  levels as allLevels,
  promptsDir,
  runsDir,
  taskIds,
} from "./config.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    args[value.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function runProcess(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);

    if (options.stdin) {
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function copyAuth(codexHome) {
  const source = path.join(os.homedir(), ".codex", "auth.json");
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(codexHome, { recursive: true });
  fs.copyFileSync(source, path.join(codexHome, "auth.json"));
  return true;
}

const args = parseArgs(process.argv.slice(2));
const selectedLevels = (args.levels ? args.levels.split(",") : allLevels).map((level) =>
  level.trim().toUpperCase(),
);
const trials = Number(args.trials ?? 1);
const model = args.model ?? "gpt-5.4-mini";
const timeoutMs = Number(args.timeoutMs ?? 600_000);
const condition = args.condition ?? "baseline";
const taskId = args.task ?? "commerce-ledger";
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

fs.mkdirSync(runsDir, { recursive: true });

for (const level of selectedLevels) {
  const prompt = fs.readFileSync(
    path.join(promptsDir, taskId, condition, `${level.toLowerCase()}.md`),
    "utf8",
  );

  for (let trial = 1; trial <= trials; trial += 1) {
    const runDir = path.join(
      runsDir,
      `${timestamp()}-${taskId}-${condition}-${level.toLowerCase()}-trial-${trial}`,
    );
    const workDir = path.join(runDir, "work");
    const runHome = path.join(runDir, "home");
    const codexHome = path.join(runDir, "codex-home");
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(runHome, { recursive: true });
    if (shouldCopyAuth) {
      copyAuth(codexHome);
    } else {
      fs.mkdirSync(codexHome, { recursive: true });
    }

    fs.writeFileSync(path.join(runDir, "prompt.md"), prompt);

    const env = {
      ...process.env,
      HOME: runHome,
      CODEX_HOME: codexHome,
      PATH: process.env.PATH ?? "",
      PORT: String(defaultPort),
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
      path.join(runDir, "last-message.txt"),
      "-C",
      workDir,
    ];

    console.log(`running Codex ${taskId} ${condition} ${level} trial ${trial} with ${model}`);
    const codex = await runProcess("codex", codexArgs, {
      cwd: workDir,
      env,
      stdin: prompt,
      timeoutMs,
    });

    fs.writeFileSync(path.join(runDir, "codex-stdout.txt"), codex.stdout);
    fs.writeFileSync(path.join(runDir, "codex-stderr.txt"), codex.stderr);
    fs.writeFileSync(path.join(runDir, "codex-result.json"), `${JSON.stringify(codex, null, 2)}\n`);

    const evalOut = path.join(runDir, "evaluation.json");
    const evaluator = await runProcess(
      bunBin,
      [
        path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname), "evaluate.mjs")),
        "--task",
        taskId,
        "--candidate",
        workDir,
        "--level",
        level,
        "--out",
        evalOut,
      ],
      {
        cwd: workDir,
        env: {
          ...process.env,
          PATH: process.env.PATH ?? "",
        },
        timeoutMs: 180_000,
      },
    );

    fs.writeFileSync(path.join(runDir, "evaluate-stdout.txt"), evaluator.stdout);
    fs.writeFileSync(path.join(runDir, "evaluate-stderr.txt"), evaluator.stderr);
    console.log(evaluator.stdout.trim());
  }
}
