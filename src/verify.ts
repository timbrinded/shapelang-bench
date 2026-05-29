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
import { defaultLanguage } from "./languages.ts";

const layerAliases = {
  routes: ["routes", "route", "handlers", "handler", "controllers", "controller", "http"],
  services: ["services", "service", "usecases", "usecase", "use-cases", "use-case"],
  repositories: ["repositories", "repository", "repos", "repo", "data-access", "data", "store"],
  models: ["models", "model", "entities", "entity", "schema", "schemas"],
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

const sourceExtensions: Record<string, RegExp> = {
  javascript: /\.(js|mjs|cjs|json|shape)$/,
  python: /\.(py|txt|toml|shape)$/,
  go: /\.(go|mod|shape)$/,
  rust: /\.(rs|toml|shape)$/,
};

async function candidateFiles(root: string, language: string): Promise<string[]> {
  const ignored = new Set([
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "node_modules",
    "runs",
    "target",
  ]);
  const extensionPattern = sourceExtensions[language] ?? sourceExtensions.javascript;
  return (await listFiles(root)).filter((file) => {
    const parts = relativePath(root, file).split("/");
    if (parts.some((part) => ignored.has(part))) return false;
    return extensionPattern.test(file);
  });
}

async function readAllSource(root: string, language: string): Promise<string> {
  const files = (await candidateFiles(root, language)).filter(
    (file) =>
      !/bun\.lock|Cargo\.lock|go\.sum|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|uv\.lock|yarn\.lock/.test(
        file,
      ),
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

async function maybeRead(root: string, path: string): Promise<string> {
  const fullPath = joinPath(root, path);
  return (await exists(fullPath)) ? await readText(fullPath) : "";
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

function hasPythonDependency(manifest: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[\\s"',\\[])${escaped}(?:\\[[^\\]]+\\])?(?=\\s|[<>=~!;,'"\\]]|$)`, "im");
  return pattern.test(manifest);
}

function hasGoModule(goMod: string, name: string): boolean {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(goMod);
}

function hasCargoDependency(cargoToml: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\n)\\s*${escaped}\\s*=`, "m").test(cargoToml);
}

async function verifyFramework(root: string, language: string): Promise<VerificationSection> {
  if (language === "python") return verifyPythonFramework(root);
  if (language === "go") return verifyGoFramework(root);
  if (language === "rust") return verifyRustFramework(root);
  return verifyJavascriptFramework(root);
}

async function verifyJavascriptFramework(root: string): Promise<VerificationSection> {
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

  return { required: true, passed: details.length === 0, details };
}

async function verifyPythonFramework(root: string): Promise<VerificationSection> {
  const details: string[] = [];
  const pyproject = await maybeRead(root, "pyproject.toml");
  const source = await readAllSource(root, "python");

  if (!pyproject) details.push("missing pyproject.toml");
  if (!(await exists(joinPath(root, "server.py")))) details.push("missing top-level server.py");
  if (!/\bname\s*=/.test(pyproject)) details.push("pyproject.toml must declare project name");
  if (!/\bversion\s*=/.test(pyproject)) details.push("pyproject.toml must declare project version");
  if (!/requires-python\s*=/.test(pyproject)) details.push("pyproject.toml must declare requires-python");
  if (!/\[tool\.uv\][\s\S]*?\bpackage\s*=\s*false\b/.test(pyproject)) {
    details.push("pyproject.toml must set [tool.uv] package = false");
  }
  if (!hasPythonDependency(pyproject, "fastapi")) details.push("fastapi must be declared in pyproject.toml");
  if (!hasPythonDependency(pyproject, "uvicorn")) details.push("uvicorn must be declared in pyproject.toml");
  if (!/\bFastAPI\s*\(/.test(source)) details.push("no FastAPI app evidence found");

  return { required: true, passed: details.length === 0, details };
}

async function verifyGoFramework(root: string): Promise<VerificationSection> {
  const details: string[] = [];
  const goMod = await maybeRead(root, "go.mod");
  const source = await readAllSource(root, "go");

  if (!goMod) details.push("missing go.mod");
  if (!(await exists(joinPath(root, "main.go")))) details.push("missing top-level main.go");
  if (!/"net\/http"/.test(source)) details.push("no net/http import evidence found");
  if (!/\bhttp\.NewServeMux\b|\bhttp\.HandleFunc\b|\bhttp\.Handle\b/.test(source)) {
    details.push("no ServeMux routing evidence found");
  }
  for (const forbidden of ["github.com/gin-gonic/gin", "github.com/go-chi/chi", "github.com/labstack/echo", "github.com/gofiber/fiber"]) {
    if (source.includes(forbidden) || goMod.includes(forbidden)) {
      details.push(`${forbidden} must not be used for net/http benchmark prompts`);
    }
  }

  return { required: true, passed: details.length === 0, details };
}

async function verifyRustFramework(root: string): Promise<VerificationSection> {
  const details: string[] = [];
  const cargoToml = await maybeRead(root, "Cargo.toml");
  const source = await readAllSource(root, "rust");

  if (!cargoToml) details.push("missing Cargo.toml");
  if (!(await exists(joinPath(root, "src", "main.rs")))) details.push("missing src/main.rs");
  if (!hasCargoDependency(cargoToml, "axum")) details.push("axum must be declared in Cargo.toml");
  if (!hasCargoDependency(cargoToml, "tokio")) details.push("tokio must be declared in Cargo.toml");
  if (!/\bRouter::new\b|\baxum::Router\b/.test(source)) details.push("no axum Router evidence found");

  return { required: true, passed: details.length === 0, details };
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

async function resolveJavascriptImport(fromFile: string, specifier: string): Promise<string | null> {
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

function upwardLayerReferences(source: string, fromLayer: string, language: string): string[] {
  const references: string[] = [];
  const fromRank = layerRank[fromLayer];
  for (const [toLayer, rank] of Object.entries(layerRank)) {
    if (fromRank >= rank) continue;
    const aliases = layerAliases[toLayer];
    const found = (aliases as readonly string[]).some((alias) => {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (language === "python") return new RegExp(`\\b(from|import)\\s+.*${escaped}\\b`).test(source);
      if (language === "go") return new RegExp(`"[^"]*\\b${escaped}\\b[^"]*"`).test(source);
      if (language === "rust") return new RegExp(`\\b(crate|super)::[^;\\n]*\\b${escaped}\\b|\\bmod\\s+${escaped}\\b`).test(source);
      return false;
    });
    if (found) references.push(toLayer);
  }
  return references;
}

async function verifyArchitecture(root: string, level: string, language: string): Promise<VerificationSection> {
  if (level === "L0") {
    return { required: false, passed: true, details: [] };
  }

  const files = await candidateFiles(root, language);
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

  if (language === "javascript") {
    const importPattern =
      /(?:import\s+[^'"]*from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\))/g;

    for (const file of files) {
      const fromLayer = layerForPath(relativePath(root, file));
      if (!fromLayer) continue;

      const source = await readText(file);
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1] ?? match[2];
        const resolved = await resolveJavascriptImport(file, specifier);
        if (!resolved) continue;

        const toLayer = layerForPath(relativePath(root, resolved));
        if (!toLayer) continue;

        if (layerRank[fromLayer] < layerRank[toLayer]) {
          details.push(`${relativePath(root, file)} imports upward from ${fromLayer} to ${toLayer}`);
        }
      }
    }
  } else {
    for (const file of files) {
      const fromLayer = layerForPath(relativePath(root, file));
      if (!fromLayer) continue;
      for (const toLayer of upwardLayerReferences(await readText(file), fromLayer, language)) {
        details.push(`${relativePath(root, file)} appears to import upward from ${fromLayer} to ${toLayer}`);
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

async function verifyDatabase(root: string, level: string, language: string): Promise<VerificationSection> {
  if (level === "L0" || level === "L1") {
    return { required: false, passed: true, details: [] };
  }

  const source = await readAllSource(root, language);
  const goMod = await maybeRead(root, "go.mod");
  const pyproject = await maybeRead(root, "pyproject.toml");
  const requirements = await maybeRead(root, "requirements.txt");
  const pythonManifest = `${pyproject}\n${requirements}`;
  const cargoToml = await maybeRead(root, "Cargo.toml");
  let found = false;

  if (language === "python") {
    found = /\bsqlite3\b|sqlite:\/\//i.test(source) || /sqlite/i.test(pythonManifest);
  } else if (language === "go") {
    const goText = `${source}\n${goMod}`;
    found =
      level === "L3"
        ? /gorm\.io\/driver\/sqlite/.test(goText)
        : /"database\/sql"/.test(source) && /modernc\.org\/sqlite|mattn\/go-sqlite3/.test(goText);
  } else if (language === "rust") {
    found = /\bsqlx\b/i.test(`${source}\n${cargoToml}`) && /\bsqlite\b/i.test(`${source}\n${cargoToml}`);
  } else {
    const sqliteEvidence = [
      /\bsqlite\b/i,
      /\bsqlite3\b/i,
      /\bbetter-sqlite3\b/i,
      /node:sqlite/i,
      /\.sqlite\b/i,
      /dialect\s*:\s*['"]sqlite['"]/i,
    ];
    found = sqliteEvidence.some((pattern) => pattern.test(source));
  }

  return {
    required: true,
    passed: found,
    details: found ? [] : ["no SQLite evidence found"],
  };
}

async function verifyOrm(root: string, level: string, language: string): Promise<VerificationSection> {
  if (level !== "L3") {
    return { required: false, passed: true, details: [] };
  }

  if (language === "python") return verifyPythonOrm(root);
  if (language === "go") return verifyGoOrm(root);
  if (language === "rust") return verifyRustOrm(root);
  return verifyJavascriptOrm(root);
}

async function verifyJavascriptOrm(root: string): Promise<VerificationSection> {
  const source = await readAllSource(root, "javascript");
  const packageJson = await readPackageJson(root);
  const sequelizeSpec = dependencySpec(packageJson, "sequelize");
  const rawSqlHints = [...source.matchAll(/\b(SELECT|INSERT|UPDATE|DELETE)\b/gi)].length;
  const details: string[] = [];

  if (!/\bsequelize\b/i.test(source)) details.push("no Sequelize evidence found");
  if (!isRegistrySpec(sequelizeSpec)) details.push("sequelize must be declared as a registry dependency");

  return { required: true, passed: details.length === 0, details, rawSqlHints };
}

async function verifyPythonOrm(root: string): Promise<VerificationSection> {
  const source = await readAllSource(root, "python");
  const pyproject = await maybeRead(root, "pyproject.toml");
  const rawSqlHints = [...source.matchAll(/\b(SELECT|INSERT|UPDATE|DELETE)\b/gi)].length;
  const details: string[] = [];

  if (!/\bsqlalchemy\b/i.test(source)) details.push("no SQLAlchemy evidence found");
  if (!hasPythonDependency(pyproject, "sqlalchemy")) details.push("sqlalchemy must be declared in pyproject.toml");

  return { required: true, passed: details.length === 0, details, rawSqlHints };
}

async function verifyGoOrm(root: string): Promise<VerificationSection> {
  const source = await readAllSource(root, "go");
  const goMod = await maybeRead(root, "go.mod");
  const rawSqlHints = [...source.matchAll(/\b(SELECT|INSERT|UPDATE|DELETE)\b/gi)].length;
  const details: string[] = [];

  if (!/\bgorm\b/i.test(source)) details.push("no GORM evidence found");
  if (!hasGoModule(goMod, "gorm.io/gorm")) details.push("gorm.io/gorm must be declared in go.mod");
  if (!hasGoModule(goMod, "gorm.io/driver/sqlite")) details.push("gorm.io/driver/sqlite must be declared in go.mod");

  return { required: true, passed: details.length === 0, details, rawSqlHints };
}

async function verifyRustOrm(root: string): Promise<VerificationSection> {
  const source = await readAllSource(root, "rust");
  const cargoToml = await maybeRead(root, "Cargo.toml");
  const rawSqlHints = [...source.matchAll(/\b(SELECT|INSERT|UPDATE|DELETE)\b/gi)].length;
  const details: string[] = [];

  if (!/\bsea_orm\b|\bsea-orm\b/i.test(`${source}\n${cargoToml}`)) details.push("no SeaORM evidence found");
  if (!hasCargoDependency(cargoToml, "sea-orm")) details.push("sea-orm must be declared in Cargo.toml");
  if (!/\bsqlx-sqlite\b|\bsqlite\b/i.test(cargoToml)) details.push("SeaORM SQLite feature evidence missing");

  return { required: true, passed: details.length === 0, details, rawSqlHints };
}

export async function verifyCandidate(root: string, level: string, language = defaultLanguage) {
  const framework = await verifyFramework(root, language);
  const architecture = await verifyArchitecture(root, level, language);
  const database = await verifyDatabase(root, level, language);
  const orm = await verifyOrm(root, level, language);

  return {
    framework,
    architecture,
    database,
    orm,
    passed: framework.passed && architecture.passed && database.passed && orm.passed,
  };
}
