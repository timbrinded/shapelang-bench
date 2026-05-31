import { shpBin } from "./config.ts";
import {
  dirname,
  exists,
  joinPath,
  listFiles,
  readJson,
  readText,
  relativePath,
  runProcess,
} from "./bun-utils.ts";

const layerAliases = {
  routes: ["routes", "route", "handlers", "handler", "controllers", "controller"],
  services: ["services", "service", "usecases", "usecase", "use-cases", "use-case"],
  repositories: ["repositories", "repository", "repos", "repo", "data-access", "data"],
  models: ["models", "model", "entities", "entity"],
} as const;

const layerRank: Record<string, number> = {
  models: 0,
  repositories: 1,
  services: 2,
  routes: 3,
};

type PackageJson = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

type VerificationSection = {
  required: boolean;
  passed: boolean;
  details: string[];
  layersSeen?: string[];
  rawSqlHints?: number;
};

async function candidateFiles(root: string): Promise<string[]> {
  const ignored = new Set(["node_modules", ".git", "runs"]);
  return (await listFiles(root)).filter((file) => {
    const parts = relativePath(root, file).split("/");
    if (parts.some((part) => ignored.has(part))) return false;
    return /\.(js|mjs|cjs|json|shape)$/.test(file);
  });
}

async function readAllSource(root: string): Promise<string> {
  const files = (await candidateFiles(root)).filter(
    (file) => !/bun\.lock|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock/.test(file),
  );
  return (await Promise.all(files.map((file) => readText(file)))).join("\n");
}

async function readPackageJson(root: string): Promise<PackageJson | null> {
  const packagePath = joinPath(root, "package.json");
  if (!(await exists(packagePath))) return null;
  try {
    return await readJson<PackageJson>(packagePath);
  } catch {
    return null;
  }
}

function dependencySpec(packageJson: PackageJson | null, name: string): string | null {
  return (
    packageJson?.dependencies?.[name] ??
    packageJson?.devDependencies?.[name] ??
    packageJson?.peerDependencies?.[name] ??
    null
  );
}

function isRegistrySpec(spec: string | null): boolean {
  return (
    typeof spec === "string" &&
    spec.length > 0 &&
    !/^(file:|link:|workspace:|portal:|patch:)/.test(spec) &&
    !/[\\/]/.test(spec)
  );
}

async function verifyFramework(root: string): Promise<VerificationSection> {
  const details: string[] = [];
  const packageJson = await readPackageJson(root);

  if (!packageJson) {
    return { required: true, passed: false, details: ["missing or invalid package.json"] };
  }

  const expressSpec = dependencySpec(packageJson, "express");
  if (!isRegistrySpec(expressSpec)) {
    details.push("express must be declared as a registry dependency");
  }

  if ((await exists(joinPath(root, "node_modules", "express", "index.js"))) && !expressSpec) {
    details.push("local node_modules/express was created without a package dependency");
  }

  return {
    required: true,
    passed: details.length === 0,
    details,
  };
}

function layerForPath(filePath: string): string | null {
  const parts = filePath.split("/").map((part) => part.toLowerCase().replace(/[_\s]/g, "-"));

  for (const [layer, aliases] of Object.entries(layerAliases)) {
    if ((aliases as readonly string[]).some((alias) => parts.includes(alias))) {
      return layer;
    }
  }
  return null;
}

async function resolveImport(fromFile: string, specifier: string): Promise<string | null> {
  if (!specifier.startsWith(".")) return null;
  const base = joinPath(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.json`,
    joinPath(base, "index.js"),
  ];

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

async function verifyArchitecture(root: string, level: string): Promise<VerificationSection> {
  if (level === "L0") {
    return { required: false, passed: true, details: [] };
  }

  const files = await candidateFiles(root);
  const layersSeen = new Set<string>();
  const details: string[] = [];

  for (const file of files) {
    const layer = layerForPath(relativePath(root, file));
    if (layer) layersSeen.add(layer);
  }

  for (const layer of Object.keys(layerAliases)) {
    if (!layersSeen.has(layer)) {
      details.push(`missing ${layer} layer`);
    }
  }

  const importPattern =
    /(?:import\s+[^'"]*from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\))/g;

  for (const file of files) {
    const fromLayer = layerForPath(relativePath(root, file));
    if (!fromLayer) continue;

    const source = await readText(file);
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2];
      const resolved = await resolveImport(file, specifier);
      if (!resolved) continue;

      const toLayer = layerForPath(relativePath(root, resolved));
      if (!toLayer) continue;

      if (layerRank[fromLayer] < layerRank[toLayer]) {
        details.push(`${relativePath(root, file)} imports upward from ${fromLayer} to ${toLayer}`);
      }
    }
  }

  return {
    required: true,
    passed: details.length === 0,
    layersSeen: [...layersSeen].sort(),
    details,
  };
}

async function verifyDatabase(root: string, level: string): Promise<VerificationSection> {
  if (level === "L0" || level === "L1") {
    return { required: false, passed: true, details: [] };
  }

  const source = await readAllSource(root);
  const sqliteEvidence = [
    /\bsqlite\b/i,
    /\bsqlite3\b/i,
    /\bbetter-sqlite3\b/i,
    /node:sqlite/i,
    /\.sqlite\b/i,
    /dialect\s*:\s*['"]sqlite['"]/i,
  ];
  const found = sqliteEvidence.some((pattern) => pattern.test(source));

  return {
    required: true,
    passed: found,
    details: found ? [] : ["no SQLite evidence found"],
  };
}

async function verifyOrm(root: string, level: string): Promise<VerificationSection> {
  if (level !== "L3") {
    return { required: false, passed: true, details: [] };
  }

  const source = await readAllSource(root);
  const packageJson = await readPackageJson(root);
  const sequelizeFound = /\bsequelize\b/i.test(source);
  const sequelizeSpec = dependencySpec(packageJson, "sequelize");
  const rawSqlHints = [...source.matchAll(/\b(SELECT|INSERT|UPDATE|DELETE)\b/gi)].length;
  const details: string[] = [];

  if (!sequelizeFound) details.push("no Sequelize evidence found");
  if (!isRegistrySpec(sequelizeSpec)) {
    details.push("sequelize must be declared as a registry dependency");
  }

  return {
    required: true,
    passed: details.length === 0,
    details,
    rawSqlHints,
  };
}

type ShapeConformance = {
  present: boolean;
  files: string[];
  fmtOk: boolean | null;
  checkOk: boolean | null;
  analyzeRan: boolean;
  conformant: boolean | null; // null when no Shape file is present (n/a)
  details: string[];
};

// Real ShapeLang conformance: validate the agent-authored .shape file with the
// actual `shp` binary instead of re-deriving structure from directory names.
// `shp fmt --check` + `shp check` decide conformance; `shp analyze` is advisory
// and only captured for transparency.
async function verifyShape(root: string): Promise<ShapeConformance> {
  const shapeFiles = (await candidateFiles(root)).filter((file) => file.endsWith(".shape"));
  if (shapeFiles.length === 0) {
    return {
      present: false,
      files: [],
      fmtOk: null,
      checkOk: null,
      analyzeRan: false,
      conformant: null,
      details: ["no .shape file present"],
    };
  }

  const relFiles = shapeFiles.map((file) => relativePath(root, file));
  const env = { ...Bun.env, PATH: Bun.env.PATH ?? "" };
  const run = (sub: string[]) =>
    runProcess(shpBin, sub, { cwd: root, env, timeoutMs: 30_000 });

  const details: string[] = [];

  const fmt = await run(["fmt", "--check", ...relFiles]);
  const fmtOk = fmt.code === 0;
  if (!fmtOk) details.push(`shp fmt --check failed: ${(fmt.stdout + fmt.stderr).trim().slice(0, 200)}`);

  const check = await run(["check", ...relFiles]);
  const checkOk = check.code === 0;
  if (!checkOk) details.push(`shp check failed: ${(check.stdout + check.stderr).trim().slice(0, 300)}`);

  // Advisory comparison of declared effects against source hints.
  const sourceFiles = (await candidateFiles(root))
    .filter((file) => /\.(js|mjs|cjs)$/.test(file))
    .map((file) => relativePath(root, file));
  let analyzeRan = false;
  if (sourceFiles.length > 0) {
    const analyze = await run([
      "analyze",
      "--shape-files",
      relFiles.join(","),
      ...sourceFiles,
    ]);
    analyzeRan = true;
    const analyzeOut = (analyze.stdout + analyze.stderr).trim();
    if (analyzeOut.length > 0) details.push(`shp analyze: ${analyzeOut.slice(0, 300)}`);
  }

  return {
    present: true,
    files: relFiles,
    fmtOk,
    checkOk,
    analyzeRan,
    conformant: fmtOk && checkOk,
    details,
  };
}

export async function verifyCandidate(root: string, level: string) {
  const framework = await verifyFramework(root);
  const architecture = await verifyArchitecture(root, level);
  const database = await verifyDatabase(root, level);
  const orm = await verifyOrm(root, level);
  const shape = await verifyShape(root);

  return {
    framework,
    architecture,
    database,
    orm,
    shape,
    passed: framework.passed && architecture.passed && database.passed && orm.passed,
  };
}
