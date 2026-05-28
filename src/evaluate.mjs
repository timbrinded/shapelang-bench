import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { bunBin, defaultPort } from "./config.mjs";
import { runBehaviorTests } from "./behavior.mjs";
import { verifyCandidate } from "./verify.mjs";

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

function runCommand(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);

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

function startServer(candidateDir, port) {
  const child = spawn(bunBin, ["run", "start"], {
    cwd: candidateDir,
    detached: true,
    env: {
      ...process.env,
      PATH: process.env.PATH ?? "",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return {
    child,
    logs: () => ({ stdout, stderr }),
    stop: () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      }
    },
  };
}

async function waitForHealth(baseUrl, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health-check`);
      if (response.status === 200) return true;
    } catch {
      // Keep polling until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

const args = parseArgs(process.argv.slice(2));
const candidateDir = path.resolve(args.candidate ?? "");
const level = args.level ?? "L0";
const taskId = args.task ?? "commerce-ledger";
const port = Number(args.port ?? defaultPort);
const outPath = args.out ? path.resolve(args.out) : null;

if (!candidateDir || !fs.existsSync(candidateDir)) {
  console.error("--candidate must point to an existing directory");
  process.exit(2);
}

function createEvaluationDir(sourceDir) {
  const evalDir = outPath
    ? path.join(path.dirname(outPath), `${path.basename(outPath, ".json")}-work`)
    : fs.mkdtempSync(path.join(os.tmpdir(), "constraint-decay-eval-"));

  fs.rmSync(evalDir, { recursive: true, force: true });
  fs.mkdirSync(evalDir, { recursive: true });
  fs.cpSync(sourceDir, evalDir, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(sourceDir, source);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      if (parts.includes("node_modules") || parts.includes(".git")) return false;
      const basename = path.basename(relative);
      if (
        [
          ".env",
          ".npmrc",
          "bun.lock",
          "package-lock.json",
          "npm-shrinkwrap.json",
          "pnpm-lock.yaml",
          "yarn.lock",
        ].includes(basename)
      ) {
        return false;
      }
      if (/\.(sqlite|sqlite-shm|sqlite-wal|db)$/.test(source)) return false;
      return true;
    },
  });
  return evalDir;
}

const evaluationDir = createEvaluationDir(candidateDir);

const install = fs.existsSync(path.join(evaluationDir, "package.json"))
  ? await runCommand(bunBin, ["install"], {
      cwd: evaluationDir,
      timeoutMs: 120_000,
      env: {
        ...process.env,
        PATH: process.env.PATH ?? "",
      },
    })
  : { code: 1, stdout: "", stderr: "missing package.json", timedOut: false };

let behavior = {
  assertionsPassed: 0,
  assertionsTotal: 0,
  assertionPassRate: 0,
  failures: [{ name: "server not evaluated", detail: "install failed or timed out" }],
};
let serverLogs = { stdout: "", stderr: "" };
let healthReady = false;

if (install.code === 0 && !install.timedOut) {
  const server = startServer(evaluationDir, port);
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    healthReady = await waitForHealth(baseUrl, 15_000);
    if (healthReady) {
      behavior = await runBehaviorTests(taskId, baseUrl);
    } else {
      behavior = {
        assertionsPassed: 0,
        assertionsTotal: 1,
        assertionPassRate: 0,
        failures: [{ name: "health check timeout", detail: "server did not become ready" }],
      };
    }
  } finally {
    serverLogs = server.logs();
    server.stop();
  }
}

const structure = verifyCandidate(candidateDir, level);
const result = {
  candidateDir,
  evaluationDir,
  level,
  taskId,
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
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
}

console.log(
  JSON.stringify(
    {
      level,
      taskId,
      assertions: `${behavior.assertionsPassed}/${behavior.assertionsTotal}`,
      assertionPassRate: behavior.assertionPassRate,
      structurePassed: structure.passed,
      passed: result.passed,
      failures: behavior.failures.slice(0, 3),
    },
    null,
    2,
  ),
);

process.exit(result.passed ? 0 : 1);
