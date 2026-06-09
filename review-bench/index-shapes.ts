import {
  exists,
  joinPath,
  listFiles,
  makeDir,
  parseArgs,
  readText,
  removePath,
  runProcess,
  writeJson,
  writeText,
} from "../src/bun-utils.ts";
import { realContext, type ReviewContext } from "./context.ts";
import { shpBin } from "./config.ts";
import { loadBenchmarkData } from "./martian.ts";
import { indexKey, listPrs } from "./prs.ts";
import { runCodexAgent } from "./agent.ts";
import { buildIndexPrompt } from "./skill-prompt.ts";
import type { PrSpec } from "./types.ts";

export type IndexOptions = {
  reuseIndex: boolean; // skip (repo, baseSha) pairs already cached
  reindex: boolean; // force rebuild even if cached
  layer2Only?: boolean; // on reindex, reuse the cached Layer-1 AST and only re-author Layer 2
};

// Languages shp can AST-parse offline (bundled tree-sitter parsers:
// javascript, typescript, tsx, go, python, rust). Java/Ruby are NOT supported.
const SOURCE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".go", ".py", ".rs"];
const EXCLUDE_SUBSTR = ["node_modules/", ".next/", "/dist/", "/build/", "coverage/", ".turbo/"];
export const AST_OUT_SUBDIR = "shape/generated/ast";

export function indexDirFor(ctx: ReviewContext, key: string): string {
  return joinPath(ctx.indexDir, key);
}

export function clonePathFor(ctx: ReviewContext, repoName: string): string {
  return joinPath(ctx.indexDir, ".clones", repoName);
}

function plainEnv(): Record<string, string | undefined> {
  return { ...Bun.env, PATH: Bun.env.PATH ?? "" };
}

// Resolve the PR's base commit so the index reflects pre-PR project state.
export async function resolveBaseSha(pr: PrSpec): Promise<string> {
  const result = await runProcess(
    "gh",
    ["pr", "view", String(pr.prNumber), "--repo", pr.repo, "--json", "baseRefOid", "-q", ".baseRefOid"],
    { cwd: ".", env: plainEnv(), timeoutMs: 60_000 },
  );
  return result.stdout.trim() || "unknown";
}

// Resolve the PR head commit (for reading files added by the PR).
export async function resolveHeadSha(pr: PrSpec): Promise<string> {
  const result = await runProcess(
    "gh",
    ["pr", "view", String(pr.prNumber), "--repo", pr.repo, "--json", "headRefOid", "-q", ".headRefOid"],
    { cwd: ".", env: plainEnv(), timeoutMs: 60_000 },
  );
  return result.stdout.trim();
}

// All changed source files in the PR (uncapped) — used to scope Phase-2 context.
export async function changedSourceFiles(pr: PrSpec): Promise<string[]> {
  const result = await runProcess(
    "gh",
    ["pr", "view", String(pr.prNumber), "--repo", pr.repo, "--json", "files", "-q", ".files[].path"],
    { cwd: ".", env: plainEnv(), timeoutMs: 60_000 },
  );
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((path) => path && !path.endsWith(".d.ts") && SOURCE_EXTS.some((ext) => path.endsWith(ext)));
}

// Blobless-clone the repo (cached) and check out the PR base commit.
export async function ensureCloneAtBase(ctx: ReviewContext, pr: PrSpec, baseSha: string): Promise<string> {
  const clone = clonePathFor(ctx, pr.repoName);
  await makeDir(joinPath(ctx.indexDir, ".clones"));
  if (!(await exists(joinPath(clone, ".git", "HEAD")))) {
    await runProcess(
      "git",
      ["clone", "--filter=blob:none", "--no-checkout", `https://github.com/${pr.repo}`, clone],
      { cwd: ".", env: plainEnv(), timeoutMs: ctx.timeoutMs },
    );
  }
  // Only fetch if the base commit isn't already present (avoids a slow/hanging
  // network fetch when the clone already has it).
  const present = await runProcess("git", ["-C", clone, "cat-file", "-e", `${baseSha}^{commit}`], {
    cwd: ".",
    env: plainEnv(),
    timeoutMs: 15_000,
  });
  if (present.code !== 0) {
    await runProcess("git", ["-C", clone, "fetch", "--filter=blob:none", "origin", baseSha], {
      cwd: ".",
      env: plainEnv(),
      timeoutMs: 300_000,
    });
  }
  const checkout = await runProcess("git", ["-C", clone, "checkout", "--force", baseSha], {
    cwd: ".",
    env: plainEnv(),
    timeoutMs: 120_000,
  });
  if (checkout.code !== 0) {
    throw new Error(`checkout ${baseSha} failed: ${checkout.stderr.slice(0, 200)}`);
  }
  return clone;
}

// A `shp` shim on PATH so an agent can call `shp ...` per the skill.
// (Usage is verified via `codex exec --json` when needed; no shim-side logging —
// the workspace-write sandbox blocks writes outside the workspace anyway.)
export async function writeShpShim(binDir: string): Promise<void> {
  await makeDir(binDir);
  const shim = joinPath(binDir, "shp");
  await writeText(shim, `#!/bin/sh\nexec "${shpBin}" "$@"\n`);
  await runProcess("chmod", ["+x", shim], { cwd: ".", env: plainEnv(), timeoutMs: 10_000 });
}

async function trackedSourceFiles(clone: string): Promise<string[]> {
  const result = await runProcess("git", ["-C", clone, "ls-files"], {
    cwd: ".",
    env: plainEnv(),
    timeoutMs: 120_000,
  });
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (path) =>
        path &&
        !path.endsWith(".d.ts") &&
        SOURCE_EXTS.some((ext) => path.endsWith(ext)) &&
        !EXCLUDE_SUBSTR.some((sub) => path.includes(sub)),
    );
}

// Whole-codebase Phase-1 build (two layers):
//  1. deterministic `shp ast source` over the ENTIRE tracked source tree (offline
//     parsers) -> shape/generated/ast/ (concrete, low-level contracts/effects).
//  2. an agent authors higher-level architecture shapes under shape/ —
//     responsibilities, code boundaries, business logic, and INVARIANTS — that
//     point back to the generated AST anchors for concrete grounding.
// The whole shape/ tree is the index; Phase 2 selects the relevant slice.
async function buildIndexReal(
  ctx: ReviewContext,
  pr: PrSpec,
  baseSha: string,
  dest: string,
  layer2Only = false,
): Promise<number> {
  const clone = await ensureCloneAtBase(ctx, pr, baseSha);
  const shapeDir = joinPath(clone, "shape");
  const genDir = joinPath(shapeDir, "generated", "ast");
  const env = plainEnv();
  let indexed = 0;

  if (layer2Only) {
    // Reuse the cached, deterministic Layer-1 AST and ONLY re-author Layer 2 (the
    // architecture/invariant shapes). The AST is identical for a given base commit,
    // so rebuilding it over the whole tree is wasted work; this makes iterating on
    // the shape-index skill cheap. Restore the cached AST into the clone so the
    // agent's `shp` calls and anchor refs resolve, then clear the stale authored
    // files in the cache so fresh authoring replaces (not accretes onto) them.
    const cachedGen = joinPath(dest, "shape", "generated");
    // `exists()` is Bun.file().exists() — false for directories — so probe a file
    // the AST layer always writes. cp -R must land at clone/shape/generated (target
    // absent), so makeDir the PARENT only, never genDir (that would nest generated/).
    const cachedManifest = joinPath(cachedGen, "ast", "manifest.json");
    if (!(await exists(cachedManifest))) {
      throw new Error(
        `layer2Only reindex needs a cached Layer-1 AST at ${cachedGen}; run a full index (no --layer2-only) first.`,
      );
    }
    await removePath(shapeDir);
    await makeDir(shapeDir);
    await runProcess("cp", ["-R", cachedGen, joinPath(shapeDir, "generated")], {
      cwd: ".",
      env: plainEnv(),
      timeoutMs: 120_000,
    });
    indexed = (await listFiles(genDir)).filter((f) => f.endsWith(".shape")).length;
    console.log(`  layer2Only: reusing ${indexed} cached AST file(s); re-authoring architecture shapes…`);
    const staleAuthored = (await listFiles(joinPath(dest, "shape"))).filter(
      (f) => f.endsWith(".shape") && !f.includes("/generated/"),
    );
    for (const f of staleAuthored) await removePath(f);
  } else {
    await removePath(shapeDir); // clear any prior (untracked) shape model in the clone
    const sources = await trackedSourceFiles(clone);

    // Layer 1: whole-codebase AST. `shp ast source --out-dir` CLEARS the dir each
    // run and aborts the whole invocation on a module-name collision (e.g. Python
    // __init__.py vs init.py) or a hard error; a single invocation can also exceed
    // ARG_MAX. So generate into a temp dir and MERGE, recursively binary-splitting
    // any failing batch to isolate (and skip) the offending file.
    await makeDir(genDir);
    const tmpAbs = joinPath(clone, ".astchunk");
    let skipped = 0;
    const generate = async (files: string[]): Promise<void> => {
      if (files.length === 0) return;
      await removePath(tmpAbs);
      const res = await runProcess(
        shpBin,
        ["ast", "source", "--allow-parse-errors", "--out-dir", ".astchunk", ...files],
        { cwd: clone, env, timeoutMs: ctx.timeoutMs },
      );
      if (res.code === 0) {
        await runProcess("rsync", ["-a", `${tmpAbs}/`, `${genDir}/`], {
          cwd: ".",
          env: plainEnv(),
          timeoutMs: 120_000,
        });
        return;
      }
      if (files.length === 1) {
        skipped += 1; // unindexable on its own (e.g. unrecoverable shp error)
        return;
      }
      const mid = Math.floor(files.length / 2);
      await generate(files.slice(0, mid));
      await generate(files.slice(mid));
    };
    const CHUNK = 1500;
    for (let i = 0; i < sources.length; i += CHUNK) {
      await generate(sources.slice(i, i + CHUNK));
    }
    await removePath(tmpAbs);
    indexed = (await listFiles(genDir)).filter((f) => f.endsWith(".shape")).length;
    if (skipped > 0) console.log(`  AST: skipped ${skipped} unindexable file(s)`);
    console.log(`  AST layer: ${indexed} files indexed; authoring architecture shapes…`);

    // Snapshot generated AST into the cache BEFORE the agent runs (the agent may
    // re-run `shp ast source` and clobber the clone's copy).
    await removePath(joinPath(dest, "shape"));
    await makeDir(joinPath(dest, "shape"));
    if (indexed > 0) {
      await runProcess(
        "cp",
        ["-R", joinPath(shapeDir, "generated"), joinPath(dest, "shape", "generated")],
        { cwd: ".", env: plainEnv(), timeoutMs: 120_000 },
      );
    }
  }

  // Layer 2: agent authors architecture + invariant shapes grounded in the AST.
  const binDir = joinPath(ctx.indexDir, ".bin");
  await writeShpShim(binDir);
  const runDir = joinPath(ctx.runsDir, `index-${indexKey(pr.repoName)}`);
  const prompt = await buildIndexPrompt(pr, indexed);
  await runCodexAgent({
    prompt,
    workDir: clone,
    runDir,
    model: ctx.reviewerModel,
    timeoutMs: ctx.timeoutMs,
    copyAuth: true,
    pathPrefix: binDir,
  });

  // Snapshot authored shapes (everything under shape/ except generated/) into the cache.
  const authored = (await listFiles(shapeDir)).filter(
    (f) => f.endsWith(".shape") && !f.includes("/generated/"),
  );
  for (const file of authored) {
    await writeText(joinPath(dest, "shape", file.slice(shapeDir.length + 1)), await readText(file));
  }
  console.log(`  authored ${authored.length} architecture shape(s)`);
  return indexed;
}

// Phase 1 — build (or reuse) a whole-codebase Shape index per (repo, baseSha).
// Returns a map of indexKey -> index directory. NOT scored.
export async function phase1Index(
  ctx: ReviewContext,
  prs: PrSpec[],
  options: IndexOptions,
): Promise<Map<string, string>> {
  const built = new Map<string, string>();
  const seen = new Set<string>();

  for (const pr of prs) {
    const key = indexKey(pr.repoName); // one index per repo
    if (seen.has(key)) continue;
    seen.add(key);

    const dest = indexDirFor(ctx, key);
    const marker = joinPath(dest, "INDEX.json");
    if ((await exists(marker)) && options.reuseIndex && !options.reindex) {
      built.set(key, dest);
      continue;
    }

    // Build once per repo, at a representative PR's base checkout.
    const baseSha = ctx.smoke ? "smoke" : await resolveBaseSha(pr);
    await makeDir(dest);
    let indexed = 0;
    if (ctx.smoke) {
      await writeText(joinPath(dest, AST_OUT_SUBDIR, "model.shape"), `# smoke index for ${pr.repoName}\n`);
      indexed = 1;
    } else {
      indexed = await buildIndexReal(ctx, pr, baseSha, dest, options.layer2Only ?? false);
    }
    await writeJson(marker, {
      repo: pr.repo,
      repoName: pr.repoName,
      baseSha,
      builtFor: pr.goldenUrl,
      indexedFiles: indexed,
      smoke: ctx.smoke,
    });
    console.log(`  indexed ${indexed} file(s) for ${key}`);
    built.set(key, dest);
  }
  return built;
}

if (import.meta.main) {
  const args = parseArgs();
  const ctx = realContext();
  const data = await loadBenchmarkData(ctx.offlineDir);
  const prs = listPrs(data, args.prs ? args.prs.split(",") : undefined);
  const layer2Only = args["layer2-only"] === "true";
  const built = await phase1Index(ctx, prs, {
    reuseIndex: args["reuse-index"] !== "false",
    reindex: args.reindex === "true" || layer2Only, // layer2Only implies a rebuild
    layer2Only,
  });
  console.log(`Phase 1 complete: ${built.size} index(es) ready`);
  for (const [key, dir] of built) console.log(`  ${key} -> ${dir}`);
}
