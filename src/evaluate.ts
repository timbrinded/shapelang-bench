import { bunBin } from "./config.ts";
import { runBehaviorTests } from "./behavior.ts";
import { verifyCandidate } from "./verify.ts";
import {
  basename,
  dirname,
  exists,
  freePort,
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

// Failure classes. `rig*` classes are caused by the harness/machine/network and
// are excluded from the functional pass-rate metric (and auto-retried). The
// remaining classes are genuine defects of the generated code.
const FAILURE_CLASSES = {
  NONE: "none",
  RIG_INSTALL: "rig_install_failure",
  RIG_PORT_CONFLICT: "rig_port_conflict",
  RIG_HARNESS_EXCEPTION: "rig_harness_exception",
  BOOT_CRASH: "boot_crash", // server process exited before serving health
  HEALTH_TIMEOUT: "health_timeout", // process alive but never served /health
  ORACLE_EXCEPTION: "oracle_exception", // behavior runner threw mid-suite
  FUNCTIONAL_FAIL: "functional_fail", // server healthy, but assertions failed
} as const;

type FailureClass = (typeof FAILURE_CLASSES)[keyof typeof FAILURE_CLASSES];

const RIG_CLASSES = new Set<FailureClass>([
  FAILURE_CLASSES.RIG_INSTALL,
  FAILURE_CLASSES.RIG_PORT_CONFLICT,
  FAILURE_CLASSES.RIG_HARNESS_EXCEPTION,
]);

const ignoredPackageArtifacts = new Set([
  ".env",
  ".npmrc",
  "bun.lock",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

type ServerOutcome = {
  healthReady: boolean;
  exited: boolean;
  exitCode: number | null;
  signal: string | null;
  portConflict: boolean;
  stdout: string;
  stderr: string;
};

function tail(text: string, lines = 40): string {
  return text.split("\n").slice(-lines).join("\n");
}

function looksLikePortConflict(logs: string): boolean {
  return /EADDRINUSE|address already in use/i.test(logs);
}

function looksLikeMissingEntry(logs: string): boolean {
  return /Module not found|Cannot find module|Cannot find package|No such file/i.test(logs);
}

// Discover the server entry file by source content (a file that calls
// app.listen / .listen(...)). Used only as a fallback when the package.json
// `start` script points at the wrong path — a packaging slip that
// disproportionately hits layered (src/) candidates and would otherwise be
// miscounted as a boot defect. A server that genuinely throws on boot still
// fails when run directly, so this never masks a real crash.
async function findEntryPoint(evalDir: string): Promise<string | null> {
  const files = (await listFiles(evalDir)).filter(
    (f) => /\.(js|mjs|cjs)$/.test(f) && !relativePath(evalDir, f).split("/").includes("node_modules"),
  );
  const listenRe = /\bapp\.listen\s*\(|\.listen\s*\(\s*(?:port|process\.env\.PORT|\d)/;
  const candidates: string[] = [];
  for (const file of files) {
    const source = await readText(file);
    if (listenRe.test(source)) candidates.push(relativePath(evalDir, file));
  }
  if (candidates.length === 0) return null;
  const preferredNames = ["server.js", "src/server.js", "index.js", "src/index.js", "app.js", "src/app.js", "main.js"];
  candidates.sort((a, b) => {
    const pa = preferredNames.indexOf(a);
    const pb = preferredNames.indexOf(b);
    if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    return a.split("/").length - b.split("/").length; // shallower first
  });
  return candidates[0];
}

// Spawn the candidate, then race health readiness against early process exit so
// a boot crash is detected immediately instead of waiting out the full timeout.
async function startServerAndProbe(
  candidateDir: string,
  port: number,
  healthTimeoutMs: number,
  startArgs: string[] = ["run", "start"],
): Promise<ServerOutcome> {
  const child = Bun.spawn([bunBin, ...startArgs], {
    cwd: candidateDir,
    env: { ...Bun.env, PATH: Bun.env.PATH ?? "", PORT: String(port) },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let stdout = "";
  let stderr = "";
  const stdoutDone = new Response(child.stdout).text().then((t) => (stdout = t));
  const stderrDone = new Response(child.stderr).text().then((t) => (stderr = t));

  let exited = false;
  let exitCode: number | null = null;
  const exitWatch = child.exited.then((code) => {
    exited = true;
    exitCode = code;
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const start = Date.now();
  let healthReady = false;

  while (Date.now() - start < healthTimeoutMs) {
    if (exited) break; // process died before serving health -> boot crash
    try {
      const response = await fetch(`${baseUrl}/api/health-check`);
      if (response.status === 200) {
        healthReady = true;
        break;
      }
    } catch {
      // not listening yet
    }
    await Bun.sleep(200);
  }

  // The probe loop only runs the behavior suite while the server stays up; the
  // caller stops it. We snapshot logs now for classification but keep the child
  // alive when health is ready so tests can run.
  if (!healthReady) {
    child.kill("SIGTERM");
    const killed = await Promise.race([
      child.exited.then(() => true),
      Bun.sleep(3000).then(() => false),
    ]);
    if (!killed) child.kill("SIGKILL");
    await Promise.allSettled([exitWatch, stdoutDone, stderrDone]);
    return {
      healthReady: false,
      exited: true,
      exitCode,
      signal: null,
      portConflict: looksLikePortConflict(stdout + stderr),
      stdout,
      stderr,
    };
  }

  // Healthy: hand back a live handle via closure stored on the object.
  (child as any).__logs = () => ({ stdout, stderr });
  (child as any).__stop = async () => {
    child.kill("SIGTERM");
    const dead = await Promise.race([
      child.exited.then(() => true),
      Bun.sleep(3000).then(() => false),
    ]);
    if (!dead) child.kill("SIGKILL");
    await Promise.allSettled([exitWatch, stdoutDone, stderrDone]);
  };
  liveChild = child;
  return {
    healthReady: true,
    exited: false,
    exitCode: null,
    signal: null,
    portConflict: false,
    stdout,
    stderr,
  };
}

let liveChild: any = null;

function shouldCopy(relative: string): boolean {
  const parts = relative.split("/");
  if (parts.includes("node_modules") || parts.includes(".git")) return false;
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

type Attempt = {
  failureClass: FailureClass;
  rigFailure: boolean;
  startFallbackUsed: boolean;
  port: number;
  install: { code: number | null; timedOut: boolean; stderrTail: string };
  server: {
    healthReady: boolean;
    exited: boolean;
    exitCode: number | null;
    stdoutTail: string;
    stderrTail: string;
  };
  behavior: {
    assertionsPassed: number;
    assertionsTotal: number;
    assertionPassRate: number;
    failures: { name: string; detail: string }[];
  };
};

// One full install+run+test attempt. Rig-class failures are auto-retried by the
// caller; functional results (including boot crashes from the candidate's own
// code) are returned as-is.
async function runOnce(
  candidateDir: string,
  outPath: string | null,
  taskId: string,
): Promise<Attempt> {
  const evaluationDir = await createEvaluationDir(candidateDir, outPath);
  const port = await freePort();

  const hasPackage = await exists(joinPath(evaluationDir, "package.json"));
  const install = hasPackage
    ? await runProcess(bunBin, ["install"], {
        cwd: evaluationDir,
        timeoutMs: 120_000,
        env: { ...Bun.env, PATH: Bun.env.PATH ?? "" },
      })
    : { code: 1, stdout: "", stderr: "missing package.json", timedOut: false };

  const installNetworkNoise =
    install.timedOut ||
    /ECONNRESET|ETIMEDOUT|ENOTFOUND|getaddrinfo|network|registry|tarball|fetch failed/i.test(
      install.stderr,
    );

  let behavior = {
    assertionsPassed: 0,
    assertionsTotal: 0,
    assertionPassRate: 0,
    failures: [] as { name: string; detail: string }[],
  };

  const baseServer = {
    healthReady: false,
    exited: false,
    exitCode: null as number | null,
    stdoutTail: "",
    stderrTail: "",
  };

  if (install.code !== 0) {
    return {
      failureClass: installNetworkNoise ? FAILURE_CLASSES.RIG_INSTALL : FAILURE_CLASSES.BOOT_CRASH,
      rigFailure: installNetworkNoise,
      startFallbackUsed: false,
      port,
      install: { code: install.code, timedOut: install.timedOut, stderrTail: tail(install.stderr) },
      server: baseServer,
      behavior: {
        ...behavior,
        assertionsTotal: 1,
        failures: [
          {
            name: installNetworkNoise ? "install network failure" : "install failed",
            detail: tail(install.stderr, 12),
          },
        ],
      },
    };
  }

  liveChild = null;
  let outcome = await startServerAndProbe(evaluationDir, port, 25_000);
  let startFallbackUsed = false;

  // If the start script merely pointed at the wrong path, retry with the real
  // entry file. Genuine boot throws do not produce a module-not-found and so do
  // not trigger this; if they did, running the same file directly fails again.
  if (!outcome.healthReady && outcome.exited && looksLikeMissingEntry(outcome.stdout + outcome.stderr)) {
    const entry = await findEntryPoint(evaluationDir);
    if (entry) {
      startFallbackUsed = true;
      liveChild = null;
      outcome = await startServerAndProbe(evaluationDir, port, 25_000, [entry]);
    }
  }

  if (!outcome.healthReady) {
    const portConflict = outcome.portConflict;
    const failureClass = portConflict
      ? FAILURE_CLASSES.RIG_PORT_CONFLICT
      : outcome.exited
        ? FAILURE_CLASSES.BOOT_CRASH
        : FAILURE_CLASSES.HEALTH_TIMEOUT;
    return {
      failureClass,
      rigFailure: portConflict,
      startFallbackUsed,
      port,
      install: { code: install.code, timedOut: false, stderrTail: "" },
      server: {
        healthReady: false,
        exited: outcome.exited,
        exitCode: outcome.exitCode,
        stdoutTail: tail(outcome.stdout),
        stderrTail: tail(outcome.stderr),
      },
      behavior: {
        ...behavior,
        assertionsTotal: 1,
        failures: [
          {
            name: failureClass,
            detail: tail(outcome.stderr || outcome.stdout, 12) || "server did not become ready",
          },
        ],
      },
    };
  }

  // Server is healthy: run the behavior oracle.
  let oracleThrew: string | null = null;
  try {
    behavior = await runBehaviorTests(taskId, `http://127.0.0.1:${port}`);
  } catch (error) {
    oracleThrew = error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    if (liveChild?.__stop) await liveChild.__stop();
  }

  const logs = liveChild?.__logs ? liveChild.__logs() : { stdout: outcome.stdout, stderr: outcome.stderr };

  if (oracleThrew !== null) {
    return {
      failureClass: FAILURE_CLASSES.ORACLE_EXCEPTION,
      rigFailure: false,
      startFallbackUsed,
      port,
      install: { code: install.code, timedOut: false, stderrTail: "" },
      server: { healthReady: true, exited: false, exitCode: null, stdoutTail: tail(logs.stdout), stderrTail: tail(logs.stderr) },
      behavior: { ...behavior, failures: [{ name: "oracle exception", detail: oracleThrew }] },
    };
  }

  const functionalFail = behavior.failures.length > 0;
  return {
    failureClass: functionalFail ? FAILURE_CLASSES.FUNCTIONAL_FAIL : FAILURE_CLASSES.NONE,
    rigFailure: false,
    startFallbackUsed,
    port,
    install: { code: install.code, timedOut: false, stderrTail: "" },
    server: { healthReady: true, exited: false, exitCode: null, stdoutTail: tail(logs.stdout), stderrTail: tail(logs.stderr) },
    behavior,
  };
}

const args = parseArgs();
const candidateDir = args.candidate ? resolvePath(args.candidate) : "";
const level = args.level ?? "L0";
const taskId = args.task ?? "commerce-ledger";
const outPath = args.out ? resolvePath(args.out) : null;
const maxRigRetries = Number(args.retries ?? 2);

if (!candidateDir || !(await exists(candidateDir))) {
  throw new Error("--candidate must point to an existing directory");
}

let attempt: Attempt;
let rigAttempts = 0;
do {
  attempt = await runOnce(candidateDir, outPath, taskId);
  if (!attempt.rigFailure) break;
  rigAttempts += 1;
} while (rigAttempts <= maxRigRetries);

const structure = await verifyCandidate(candidateDir, level);

// The functional pass-rate is null when a rig-class failure prevented us from
// ever measuring the candidate's behavior, so it can be excluded from analysis.
const functionalPassRate = attempt.rigFailure ? null : attempt.behavior.assertionPassRate;

const result = {
  candidateDir,
  level,
  taskId,
  condition: args.condition ?? null,
  model: args.model ?? null,
  generation: args.generation ? Number(args.generation) : null,
  port: attempt.port,
  install: attempt.install,
  server: attempt.server,
  behavior: attempt.behavior,
  structure,
  shape: structure.shape,
  failureClass: attempt.failureClass,
  rigFailure: attempt.rigFailure,
  startFallbackUsed: attempt.startFallbackUsed,
  rigAttempts,
  functionalPassRate,
  // `passed` keeps the original meaning for back-compat: clean behavior + structure.
  passed: !attempt.rigFailure && attempt.behavior.failures.length === 0 && structure.passed,
  evaluatedAt: new Date().toISOString(),
};

if (outPath) {
  await writeJson(outPath, result);
}

console.log(
  JSON.stringify(
    {
      level,
      taskId,
      assertions: `${attempt.behavior.assertionsPassed}/${attempt.behavior.assertionsTotal}`,
      functionalPassRate,
      failureClass: attempt.failureClass,
      rigFailure: attempt.rigFailure,
      structurePassed: structure.passed,
      shapeConformant: structure.shape?.conformant ?? null,
      passed: result.passed,
      failures: attempt.behavior.failures.slice(0, 3).map((f) => f.name),
    },
    null,
    2,
  ),
);

// Exit non-zero only for genuine rig failures so orchestration can retry; a
// functional failure is a valid measured result and must exit 0.
if (attempt.rigFailure) {
  process.exitCode = 2;
}
