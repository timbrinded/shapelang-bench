import { $ } from "bun";

export type CliArgs = Record<string, string>;

export type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export function normalizePath(value: string): string {
  const absolute = value.startsWith("/");
  const parts: string[] = [];

  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  const normalized = `${absolute ? "/" : ""}${parts.join("/")}`;
  return normalized || (absolute ? "/" : ".");
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

export function dirname(value: string): string {
  const normalized = normalizePath(value);
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return normalized.startsWith("/") ? "/" : ".";
  return normalized.slice(0, index);
}

export function basename(value: string, extension = ""): string {
  const normalized = normalizePath(value);
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  return extension && name.endsWith(extension) ? name.slice(0, -extension.length) : name;
}

export function relativePath(root: string, value: string): string {
  const normalizedRoot = normalizePath(root);
  const normalizedValue = normalizePath(value);
  if (normalizedValue === normalizedRoot) return "";
  const prefix = `${normalizedRoot}/`;
  return normalizedValue.startsWith(prefix) ? normalizedValue.slice(prefix.length) : normalizedValue;
}

export function resolvePath(value: string, base = Bun.env.PWD ?? "."): string {
  return value.startsWith("/") ? normalizePath(value) : joinPath(base, value);
}

export function pathFromImport(importUrl: string, relative: string): string {
  return normalizePath(decodeURIComponent(new URL(relative, importUrl).pathname));
}

export function parseArgs(argv: string[] = Bun.argv.slice(2)): CliArgs {
  const args: CliArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      // Bare boolean flag — never consume the next token, or `--a --b v`
      // would record "--b" as a's value AND silently drop b entirely.
      args[value.slice(2)] = "true";
    } else {
      args[value.slice(2)] = next;
      index += 1;
    }
  }
  return args;
}

export async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

export async function readText(path: string): Promise<string> {
  return Bun.file(path).text();
}

export async function readJson<T = unknown>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T;
}

export async function writeText(path: string, data: string): Promise<void> {
  await Bun.write(path, data);
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

export async function makeDir(path: string): Promise<void> {
  await $`mkdir -p ${path}`.quiet();
}

export async function removePath(path: string): Promise<void> {
  await $`rm -rf ${path}`.quiet();
}

export async function tempDir(prefix: string): Promise<string> {
  const root = Bun.env.TMPDIR ?? "/tmp";
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = joinPath(root, `${prefix}${suffix}`);
  await makeDir(path);
  return path;
}

export async function listFiles(root: string): Promise<string[]> {
  // NB: do not gate on exists() — Bun.file().exists() is false for directories.
  // Scanning a missing dir throws; treat that as "no files".
  const files: string[] = [];
  try {
    const glob = new Bun.Glob("**/*");
    for await (const relative of glob.scan({ cwd: root, dot: true })) {
      const path = joinPath(root, String(relative));
      try {
        const stat = await Bun.file(path).stat();
        if (stat.isFile()) files.push(path);
      } catch {
        // The glob can race with cleanup in run directories. Ignore vanished files.
      }
    }
  } catch {
    return [];
  }
  return files.sort();
}

export async function modifiedTime(path: string): Promise<number> {
  return (await Bun.file(path).stat()).mtimeMs;
}

export async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: Record<string, string | undefined>;
    stdin?: string;
    timeoutMs: number;
  },
): Promise<CommandResult> {
  const child = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Writing to / closing stdin can EPIPE if the child already died (e.g. codex
  // crashing on launch); never let that throw out of runProcess.
  if (options.stdin !== undefined) {
    try {
      child.stdin.write(options.stdin);
    } catch {
      // child gone before stdin accepted — code/stderr below tell the real story
    }
  }
  try {
    child.stdin.end();
  } catch {
    // ignore
  }

  // Begin draining the pipes immediately so the child never blocks on a full
  // buffer. These promises resolve on pipe EOF.
  const stdoutPromise = new Response(child.stdout).text().catch(() => "");
  const stderrPromise = new Response(child.stderr).text().catch(() => "");

  // Hard kill at the deadline: SIGTERM, then SIGKILL shortly after in case the
  // child ignores SIGTERM. Guarantees `child.exited` resolves within ~timeout.
  let timedOut = false;
  let sigkillTimer: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
    sigkillTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }, 5_000);
  }, options.timeoutMs);

  const code = await child.exited;
  clearTimeout(timer);
  if (sigkillTimer) clearTimeout(sigkillTimer);

  // The child has exited, but a lingering grandchild can inherit the stdout/stderr
  // fds and hold the pipe open, so `.text()` may never see EOF — this once wedged a
  // worker for 8+ hours. Cap the post-exit drain: take whatever is buffered after a
  // short grace and move on. Callers that need full output read it from disk
  // (review.json / --output-last-message), so abandoning a stuck pipe is safe.
  const DRAIN_GRACE_MS = 15_000;
  const drained = await Promise.race([
    Promise.all([stdoutPromise, stderrPromise]),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), DRAIN_GRACE_MS)),
  ]);
  const [stdout, stderr] = drained ?? ["", ""];
  return { code, stdout, stderr, timedOut };
}
