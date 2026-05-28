import {
  basename,
  dirname,
  exists,
  joinPath,
  listFiles,
  readJson,
  readText,
  relativePath,
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

export async function verifyCandidate(root: string, level: string) {
  const framework = await verifyFramework(root);
  const architecture = await verifyArchitecture(root, level);
  const database = await verifyDatabase(root, level);
  const orm = await verifyOrm(root, level);

  return {
    framework,
    architecture,
    database,
    orm,
    passed: framework.passed && architecture.passed && database.passed && orm.passed,
  };
}
