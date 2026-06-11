import { bunBin, defaultPort } from "./config.ts";
import { runBehaviorTests } from "./behavior.ts";
import { shouldCopy } from "./eval-hygiene.ts";
import { verifyCandidate } from "./verify.ts";
import {
  basename,
  dirname,
  exists,
  joinPath,
  listFiles,
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
  logs: () => { stdout: string; stderr: string };
  stop: () => Promise<void>;
};

async function startServer(candidateDir: string, port: number): Promise<RunningServer> {
  const child = Bun.spawn([bunBin, "run", "start"], {
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
  const stdoutText = new Response(child.stdout).text().then((text) => {
    stdout = text;
  });
  const stderrText = new Response(child.stderr).text().then((text) => {
    stderr = text;
  });

  return {
    logs: () => ({ stdout, stderr }),
    stop: async () => {
      child.kill("SIGTERM");
      await Promise.allSettled([child.exited, stdoutText, stderrText]);
    },
  };
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health-check`);
      if (response.status === 200) return true;
    } catch {
      // Keep polling until timeout.
    }
    await Bun.sleep(250);
  }
  return false;
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
const port = Number(args.port ?? defaultPort);
const outPath = args.out ? resolvePath(args.out) : null;

if (!candidateDir || !(await exists(candidateDir))) {
  throw new Error("--candidate must point to an existing directory");
}

const evaluationDir = await createEvaluationDir(candidateDir, outPath);

const install = (await exists(joinPath(evaluationDir, "package.json")))
  ? await runProcess(bunBin, ["install"], {
      cwd: evaluationDir,
      timeoutMs: 120_000,
      env: {
        ...Bun.env,
        PATH: Bun.env.PATH ?? "",
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
  const server = await startServer(evaluationDir, port);
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
    await server.stop();
    serverLogs = server.logs();
  }
}

const structure = await verifyCandidate(candidateDir, level);
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
  await writeJson(outPath, result);
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

if (!result.passed) {
  throw new Error("candidate failed evaluation");
}
