import fs from "node:fs";
import path from "node:path";

const layerAliases = {
  routes: ["routes", "route", "handlers", "handler", "controllers", "controller"],
  services: ["services", "service", "usecases", "usecase", "use-cases", "use-case"],
  repositories: ["repositories", "repository", "repos", "repo", "data-access", "data"],
  models: ["models", "model", "entities", "entity"],
};

const layerRank = {
  models: 0,
  repositories: 1,
  services: 2,
  routes: 3,
};

function walkFiles(root) {
  const files = [];
  const ignored = new Set(["node_modules", ".git", "runs"]);

  function walk(current) {
    if (!fs.existsSync(current)) return;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      if (ignored.has(path.basename(current))) return;
      for (const entry of fs.readdirSync(current)) {
        walk(path.join(current, entry));
      }
      return;
    }
    if (/\.(js|mjs|cjs|json)$/.test(current)) {
      files.push(current);
    }
  }

  walk(root);
  return files;
}

function readAllSource(root) {
  return walkFiles(root)
    .filter((file) => !/bun\.lock|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock/.test(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

function readPackageJson(root) {
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    return null;
  }
}

function dependencySpec(packageJson, name) {
  return (
    packageJson?.dependencies?.[name] ??
    packageJson?.devDependencies?.[name] ??
    packageJson?.peerDependencies?.[name] ??
    null
  );
}

function isRegistrySpec(spec) {
  return (
    typeof spec === "string" &&
    spec.length > 0 &&
    !/^(file:|link:|workspace:|portal:|patch:)/.test(spec) &&
    !/[\\/]/.test(spec)
  );
}

function verifyFramework(root) {
  const details = [];
  const packageJson = readPackageJson(root);
  if (!packageJson) {
    return { required: true, passed: false, details: ["missing or invalid package.json"] };
  }

  const expressSpec = dependencySpec(packageJson, "express");
  if (!isRegistrySpec(expressSpec)) {
    details.push("express must be declared as a registry dependency");
  }

  const nodeModulesExpress = path.join(root, "node_modules", "express", "index.js");
  if (fs.existsSync(nodeModulesExpress) && !expressSpec) {
    details.push("local node_modules/express was created without a package dependency");
  }

  return {
    required: true,
    passed: details.length === 0,
    details,
  };
}

function layerForPath(filePath) {
  const parts = filePath
    .split(path.sep)
    .map((part) => part.toLowerCase().replace(/[_\s]/g, "-"));

  for (const [layer, aliases] of Object.entries(layerAliases)) {
    if (parts.some((part) => aliases.includes(part))) {
      return layer;
    }
  }
  return null;
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, "index.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function verifyArchitecture(root, level) {
  if (level === "L0") {
    return { required: false, passed: true, details: [] };
  }

  const files = walkFiles(root);
  const layersSeen = new Set();
  const details = [];

  for (const file of files) {
    const layer = layerForPath(path.relative(root, file));
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
    const fromLayer = layerForPath(path.relative(root, file));
    if (!fromLayer) continue;

    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2];
      const resolved = resolveImport(file, specifier);
      if (!resolved) continue;

      const toLayer = layerForPath(path.relative(root, resolved));
      if (!toLayer) continue;

      if (layerRank[fromLayer] < layerRank[toLayer]) {
        details.push(
          `${path.relative(root, file)} imports upward from ${fromLayer} to ${toLayer}`,
        );
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

function verifyDatabase(root, level) {
  if (level === "L0" || level === "L1") {
    return { required: false, passed: true, details: [] };
  }

  const source = readAllSource(root);
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

function verifyOrm(root, level) {
  if (level !== "L3") {
    return { required: false, passed: true, details: [] };
  }

  const source = readAllSource(root);
  const packageJson = readPackageJson(root);
  const sequelizeFound = /\bsequelize\b/i.test(source);
  const sequelizeSpec = dependencySpec(packageJson, "sequelize");
  const rawSqlHints = [...source.matchAll(/\b(SELECT|INSERT|UPDATE|DELETE)\b/gi)].length;
  const details = [];
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

export function verifyCandidate(root, level) {
  const framework = verifyFramework(root);
  const architecture = verifyArchitecture(root, level);
  const database = verifyDatabase(root, level);
  const orm = verifyOrm(root, level);

  return {
    framework,
    architecture,
    database,
    orm,
    passed: framework.passed && architecture.passed && database.passed && orm.passed,
  };
}
