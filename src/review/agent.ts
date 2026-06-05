import {
  exists,
  joinPath,
  readText,
  runProcess,
  writeText,
  type CommandResult,
} from "../bun-utils.ts";

// Run a Codex agent with an isolated HOME/CODEX_HOME, mirroring src/run-codex.ts.
// Used by Phase 1 (indexing) and Phase 2 (review). The prompt is the assembled
// skill; the agent works inside `workDir` (a repo clone or review workspace).
export async function runCodexAgent(opts: {
  prompt: string;
  workDir: string;
  runDir: string;
  model: string;
  timeoutMs: number;
  copyAuth?: boolean;
  pathPrefix?: string; // prepended to PATH (e.g. a dir holding a `shp` shim)
}): Promise<{ codex: CommandResult; lastMessage: string }> {
  const runHome = joinPath(opts.runDir, "home");
  const codexHome = joinPath(opts.runDir, "codex-home");
  await writeText(joinPath(runHome, ".gitkeep"), "");
  await writeText(joinPath(codexHome, ".gitkeep"), "");

  if (opts.copyAuth) {
    const home = Bun.env.HOME;
    if (home) {
      const source = joinPath(home, ".codex", "auth.json");
      if (await exists(source)) {
        await writeText(joinPath(codexHome, "auth.json"), await readText(source));
      }
    }
  }

  await writeText(joinPath(opts.runDir, "prompt.md"), opts.prompt);

  const basePath = Bun.env.PATH ?? "";
  const env = {
    ...Bun.env,
    HOME: runHome,
    CODEX_HOME: codexHome,
    PATH: opts.pathPrefix ? `${opts.pathPrefix}:${basePath}` : basePath,
  };

  const codexArgs = [
    "exec",
    "--model",
    opts.model,
    "--ignore-user-config",
    "--ignore-rules",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--output-last-message",
    joinPath(opts.runDir, "last-message.txt"),
    "-C",
    opts.workDir,
  ];

  const codex = await runProcess("codex", codexArgs, {
    cwd: opts.workDir,
    env,
    stdin: opts.prompt,
    timeoutMs: opts.timeoutMs,
  });

  await writeText(joinPath(opts.runDir, "codex-stdout.txt"), codex.stdout);
  await writeText(joinPath(opts.runDir, "codex-stderr.txt"), codex.stderr);

  const lastMessagePath = joinPath(opts.runDir, "last-message.txt");
  const lastMessage = (await exists(lastMessagePath)) ? await readText(lastMessagePath) : "";
  return { codex, lastMessage };
}
