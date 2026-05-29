import { bunBin, defaultPort } from "./config.ts";
import { runBehaviorTests } from "./behavior.ts";
import { verifyCandidate } from "./verify.ts";
import { defaultLanguage, languageIds } from "./languages.ts";
import {
  basename,
  dirname,
  exists,
  joinPath,
  listFiles,
  makeDir,
  parseArgs,
  readText,
  relativePath,
  removePath,
  resolvePath,
  runProcess,
  tempDir,
  writeJson,
  writeText,
} from "./bun-utils.ts";

type RunningServer = {
  exitCode: () => number | null | undefined;
  hasExited: () => boolean;
  logs: () => { stdout: string; stderr: string };
  stop: () => Promise<void>;
};

type ReadinessResult = {
  ready: boolean;
  failure?: { name: string; detail: string };
};

const ignoredPackageArtifacts = new Set([
  ".env",
  ".npmrc",
  "bun.lock",
  "Cargo.lock",
  "go.sum",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const ignoredDirectories = new Set([
  ".git",
  ".bench-bin",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".venv",
  "__pycache__",
  "node_modules",
  "runs",
  "target",
]);

function combineResults(results: Array<{ label: string; result: any }>) {
  const failed = results.find(({ result }) => result.code !== 0 || result.timedOut);
  return {
    code: failed ? failed.result.code : 0,
    stdout: results.map(({ label, result }) => `$ ${label}\n${result.stdout}`).join("\n"),
    stderr: results.map(({ label, result }) => `$ ${label}\n${result.stderr}`).join("\n"),
    timedOut: results.some(({ result }) => result.timedOut),
  };
}

function trimDetail(value: string, maxLength = 4_000): string {
  if (value.length <= maxLength) return value;
  const side = Math.floor((maxLength - 32) / 2);
  return `${value.slice(0, side)}\n... truncated ...\n${value.slice(-side)}`;
}

function preBehaviorFailure(name: string, detail: string) {
  return {
    assertionsPassed: 0,
    assertionsTotal: 0,
    assertionPassRate: null,
    failures: [{ name, detail: trimDetail(detail) }],
  };
}

function serverExitDetail(
  failure: { name: string; detail: string },
  server: RunningServer,
): string {
  const logs = server.logs();
  const sections = [
    failure.detail,
    logs.stdout ? `stdout:\n${logs.stdout}` : "",
    logs.stderr ? `stderr:\n${logs.stderr}` : "",
  ].filter(Boolean);
  return trimDetail(sections.join("\n\n"));
}

async function installCandidate(candidateDir: string, language: string) {
  const env = { ...Bun.env, PATH: Bun.env.PATH ?? "" };

  if (language === "javascript") {
    return (await exists(joinPath(candidateDir, "package.json")))
      ? await runProcess(bunBin, ["install"], { cwd: candidateDir, timeoutMs: 120_000, env })
      : { code: 1, stdout: "", stderr: "missing package.json", timedOut: false };
  }

  if (language === "python") {
    if (!(await exists(joinPath(candidateDir, "requirements.txt")))) {
      return { code: 1, stdout: "", stderr: "missing requirements.txt", timedOut: false };
    }
    const python = Bun.env.PYTHON_BIN ?? "python3";
    const venv = await runProcess(python, ["-m", "venv", ".venv"], {
      cwd: candidateDir,
      timeoutMs: 60_000,
      env,
    });
    if (venv.code !== 0 || venv.timedOut) {
      return combineResults([{ label: `${python} -m venv .venv`, result: venv }]);
    }
    const pipPython = joinPath(candidateDir, ".venv", "bin", "python");
    const pip = await runProcess(pipPython, ["-m", "pip", "install", "-r", "requirements.txt"], {
      cwd: candidateDir,
      timeoutMs: 180_000,
      env,
    });
    return combineResults([
      { label: `${python} -m venv .venv`, result: venv },
      { label: `${pipPython} -m pip install -r requirements.txt`, result: pip },
    ]);
  }

  if (language === "go") {
    if (!(await exists(joinPath(candidateDir, "go.mod")))) {
      return { code: 1, stdout: "", stderr: "missing go.mod", timedOut: false };
    }
    const go = Bun.env.GO_BIN ?? "go";
    const download = await runProcess(go, ["mod", "download"], {
      cwd: candidateDir,
      timeoutMs: 120_000,
      env,
    });
    if (download.code !== 0 || download.timedOut) {
      return combineResults([{ label: `${go} mod download`, result: download }]);
    }
    const tidy = await runProcess(go, ["mod", "tidy"], {
      cwd: candidateDir,
      timeoutMs: 120_000,
      env,
    });
    if (tidy.code !== 0 || tidy.timedOut) {
      return combineResults([
        { label: `${go} mod download`, result: download },
        { label: `${go} mod tidy`, result: tidy },
      ]);
    }
    const buildDir = joinPath(candidateDir, ".bench-bin");
    await removePath(buildDir);
    await makeDir(buildDir);
    const outputPath = joinPath(buildDir, "server");
    const build = await runProcess(go, ["build", "-o", outputPath, "."], {
      cwd: candidateDir,
      timeoutMs: 180_000,
      env,
    });
    return combineResults([
      { label: `${go} mod download`, result: download },
      { label: `${go} mod tidy`, result: tidy },
      { label: `${go} build -o ${outputPath} .`, result: build },
    ]);
  }

  if (language === "rust") {
    if (!(await exists(joinPath(candidateDir, "Cargo.toml")))) {
      return { code: 1, stdout: "", stderr: "missing Cargo.toml", timedOut: false };
    }
    const cargo = Bun.env.CARGO_BIN ?? "cargo";
    const fetch = await runProcess(cargo, ["fetch"], {
      cwd: candidateDir,
      timeoutMs: 180_000,
      env,
    });
    if (fetch.code !== 0 || fetch.timedOut) {
      return combineResults([{ label: `${cargo} fetch`, result: fetch }]);
    }
    const build = await runProcess(cargo, ["build", "--quiet"], {
      cwd: candidateDir,
      timeoutMs: 300_000,
      env,
    });
    return combineResults([
      { label: `${cargo} fetch`, result: fetch },
      { label: `${cargo} build --quiet`, result: build },
    ]);
  }

  return { code: 1, stdout: "", stderr: `unsupported language: ${language}`, timedOut: false };
}

function startCommand(candidateDir: string, language: string): string[] {
  if (language === "javascript") return [bunBin, "run", "start"];
  if (language === "python") return [joinPath(candidateDir, ".venv", "bin", "python"), "server.py"];
  if (language === "go") return [joinPath(candidateDir, ".bench-bin", "server")];
  if (language === "rust") return [Bun.env.CARGO_BIN ?? "cargo", "run", "--quiet"];
  throw new Error(`unsupported language: ${language}`);
}

async function startServer(candidateDir: string, port: number, language: string): Promise<RunningServer> {
  const command = startCommand(candidateDir, language);
  const child = Bun.spawn(command, {
    cwd: candidateDir,
    env: {
      ...Bun.env,
      PATH: Bun.env.PATH ?? "",
      PORT: String(port),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let stdout = "";
  let stderr = "";
  let exitCode: number | null | undefined;
  const exited = child.exited.then((code) => {
    exitCode = code;
    return code;
  });
  const stdoutText = new Response(child.stdout).text().then((text) => {
    stdout = text;
  });
  const stderrText = new Response(child.stderr).text().then((text) => {
    stderr = text;
  });

  return {
    exitCode: () => exitCode,
    hasExited: () => exitCode !== undefined,
    logs: () => ({ stdout, stderr }),
    stop: async () => {
      if (exitCode === undefined) {
        child.kill("SIGTERM");
      }
      await Promise.allSettled([exited, stdoutText, stderrText]);
    },
  };
}

async function waitForHealth(
  baseUrl: string,
  timeoutMs: number,
  server: RunningServer,
): Promise<ReadinessResult> {
  const start = Date.now();
  let lastStatus = "";
  while (Date.now() - start < timeoutMs) {
    if (server.hasExited()) {
      return {
        ready: false,
        failure: {
          name: "server exited before health check",
          detail: `server process exited with code ${server.exitCode() ?? "unknown"}`,
        },
      };
    }
    try {
      const response = await fetch(`${baseUrl}/api/health-check`);
      lastStatus = `last health status ${response.status}`;
      if (response.status === 200) return { ready: true };
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
      // Keep polling until timeout.
    }
    await Bun.sleep(250);
  }
  return {
    ready: false,
    failure: {
      name: "health check timeout",
      detail: lastStatus ? `server did not become ready (${lastStatus})` : "server did not become ready",
    },
  };
}

function shouldCopy(relative: string): boolean {
  const parts = relative.split("/");
  if (parts.some((part) => ignoredDirectories.has(part))) return false;
  if (ignoredPackageArtifacts.has(basename(relative))) return false;
  if (/\.(sqlite|sqlite-shm|sqlite-wal|db)$/.test(relative)) return false;
  return true;
}

async function createEvaluationDir(sourceDir: string, outPath: string | null): Promise<string> {
  const evalDir = outPath
    ? joinPath(dirname(outPath), `${basename(outPath, ".json")}-work`)
    : await tempDir("constraint-decay-eval-");

  await removePath(evalDir);

  for (const source of await listFiles(sourceDir)) {
    const relative = relativePath(sourceDir, source);
    if (!shouldCopy(relative)) continue;
    await writeText(joinPath(evalDir, relative), await readText(source));
  }

  return evalDir;
}

const args = parseArgs();
const candidateDir = args.candidate ? resolvePath(args.candidate) : "";
const level = args.level ?? "L0";
const taskId = args.task ?? "commerce-ledger";
const condition = args.condition ?? null;
const model = args.model ?? "unknown";
const language = args.language ?? defaultLanguage;
const port = Number(args.port ?? defaultPort);
const outPath = args.out ? resolvePath(args.out) : null;
const healthTimeoutMs = Number(args.healthTimeoutMs ?? (language === "rust" ? 60_000 : 20_000));

if (!candidateDir || !(await exists(candidateDir))) {
  throw new Error("--candidate must point to an existing directory");
}
if (!languageIds.includes(language)) {
  throw new Error(`unknown language: ${language}`);
}

const evaluationDir = await createEvaluationDir(candidateDir, outPath);
const install = await installCandidate(evaluationDir, language);

let phase = "install";
let behavior = preBehaviorFailure(
  install.timedOut ? "install timeout" : "install failed",
  install.stderr || install.stdout || "install failed before server start",
);
let serverLogs = { stdout: "", stderr: "" };
let healthReady = false;

if (install.code === 0 && !install.timedOut) {
  phase = "startup";
  const server = await startServer(evaluationDir, port, language);
  let readiness: ReadinessResult = {
    ready: false,
    failure: { name: "health check timeout", detail: "server did not become ready" },
  };
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    readiness = await waitForHealth(baseUrl, healthTimeoutMs, server);
    healthReady = readiness.ready;
    if (readiness.ready) {
      phase = "behavior";
      behavior = await runBehaviorTests(taskId, baseUrl);
    }
  } finally {
    await server.stop();
    serverLogs = server.logs();
  }
  if (!readiness.ready) {
    const failure = readiness.failure ?? {
      name: "health check timeout",
      detail: "server did not become ready",
    };
    behavior = preBehaviorFailure(
      failure.name,
      failure.name === "server exited before health check"
        ? serverExitDetail(failure, server)
        : failure.detail,
    );
  }
}

const structure = await verifyCandidate(candidateDir, level, language);
const result = {
  candidateDir,
  evaluationDir,
  model,
  language,
  condition,
  level,
  taskId,
  phase,
  port,
  install,
  healthReady,
  behavior,
  structure,
  passed: behavior.failures.length === 0 && structure.passed,
  evaluatedAt: new Date().toISOString(),
  serverLogs,
};

if (outPath) {
  await writeJson(outPath, result);
}

console.log(
  JSON.stringify(
    {
      level,
      model,
      language,
      condition,
      taskId,
      phase,
      assertions:
        behavior.assertionsTotal > 0
          ? `${behavior.assertionsPassed}/${behavior.assertionsTotal}`
          : "not run",
      assertionPassRate: behavior.assertionPassRate,
      structurePassed: structure.passed,
      passed: result.passed,
      failures: behavior.failures.slice(0, 3),
    },
    null,
    2,
  ),
);

if (!result.passed) {
  throw new Error("candidate failed evaluation");
}
