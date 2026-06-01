import { joinPath, pathFromImport } from "./bun-utils.ts";

export const harnessDir = pathFromImport(import.meta.url, "..");

export const promptsDir = joinPath(harnessDir, "prompts");
export const runsDir = joinPath(harnessDir, "runs");
export const tasksDir = joinPath(harnessDir, "tasks");
export const defaultPort = 3137;
export const bunBin = Bun.env.BUN_BIN ?? "bun";
export const shpBin = Bun.env.SHP_BIN ?? "shp";

// The experiment conditions. `control` is a vanilla coding agent given only the
// spec; `shapelang` is the same agent told to use the ShapeLang skill. Codex is
// run with an isolated CODEX_HOME (no skills dir), so the control provably cannot
// discover ShapeLang; the shapelang arm is pointed at the skill by absolute path
// in its prompt.
export const conditions = ["control", "shapelang"];

// Absolute path to the ShapeLang skill the shapelang arm is told to use.
export const shapeSkillPath =
  Bun.env.SHAPE_SKILL_PATH ?? "/home/timbo/.claude/skills/shape-lang";

// Prompt fragment for the shapelang arm. It does NOT inline a contract — the
// agent reads the skill and uses the shp CLI itself, which is the mechanism
// under test.
export const shapelangInstruction = `## Use ShapeLang

A ShapeLang skill is installed at \`${shapeSkillPath}\`. Read its \`SKILL.md\` and
the referenced guides, then USE it for this work:

- Author and maintain a Shape architecture model under \`shape/*.shape\` that
  reflects this service's components, resources, relations, and effects.
- Use the \`shp\` CLI (on PATH) as you work — at minimum \`shp fmt --check\` and
  \`shp check\` — and keep the model valid and consistent with the code.
- Treat the Shape model as the source of truth for architecture: before adding or
  changing code, consult it, update it, and re-run \`shp check\` so the
  implementation cannot silently drift from the contract.`;
export const taskIds = [
  "commerce-ledger",
  "coupon-redemptions",
  "grant-budgets",
  "rebate-claims",
  "stipend-awards",
];

// The paper's constraint ladder (Dente et al., "Constraint Decay"): a fixed API
// contract under increasing non-functional/structural density. Each level is a
// single 0-shot generation. L0 = framework only (baseline); then +Clean
// Architecture, +SQLite persistence, +Sequelize ORM accumulate. Decay = the drop
// in original-spec conformance (and structural compliance) from L0 to L3.
export const levels = ["L0", "L1", "L2", "L3"];

export const constraintBlocks: Record<string, string> = {
  L0: `## Structural Constraints

- No additional structural constraints. In-memory storage is allowed.`,
  L1: `## Structural Constraints

- Follow a layered (Clean Architecture) design with separate directories for
  routes/handlers, services/use-cases, repositories/data-access, and
  models/entities.
- Dependencies point one way only: routes -> services -> repositories -> models.
  Lower layers must not import higher layers.
- In-memory storage is allowed.`,
  L2: `## Structural Constraints

- Follow a layered (Clean Architecture) design with separate directories for
  routes/handlers, services/use-cases, repositories/data-access, and
  models/entities; lower layers must not import higher layers.
- Persist all task entities and mutable state in SQLite. Create the schema
  automatically on server startup. Do not use in-memory-only storage for
  persisted entities.`,
  L3: `## Structural Constraints

- Follow a layered (Clean Architecture) design with separate directories for
  routes/handlers, services/use-cases, repositories/data-access, and
  models/entities; lower layers must not import higher layers.
- Persist all task entities and mutable state in SQLite, with the schema created
  automatically on server startup.
- Use the Sequelize ORM for all model definitions and data access. Do not use
  raw SQL as the primary data-access mechanism.`,
};

