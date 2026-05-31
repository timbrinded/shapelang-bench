import { joinPath, pathFromImport } from "./bun-utils.ts";

export const harnessDir = pathFromImport(import.meta.url, "..");

export const repoRoot = harnessDir;
export const promptsDir = joinPath(harnessDir, "prompts");
export const runsDir = joinPath(harnessDir, "runs");
export const tasksDir = joinPath(harnessDir, "tasks");
export const defaultPort = 3137;
export const bunBin = Bun.env.BUN_BIN ?? "bun";
export const shpBin = Bun.env.SHP_BIN ?? "shp";

export const levels = ["L0", "L1", "L2", "L3"]; // legacy (constraint-level experiment)

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

export const constraintBlocks = {
  L0: `## Structural Constraints

- No additional structural constraints.
- In-memory storage is allowed.
`,
  L1: `## Structural Constraints

- Follow a layered architecture.
- Keep routes, services, repositories, and models in separate directories.
- Routes may call services.
- Services may call repositories and models.
- Repositories may call models.
- Lower layers must not import higher layers.
- In-memory storage is allowed.
`,
  L2: `## Structural Constraints

- Follow a layered architecture.
- Keep routes, services, repositories, and models in separate directories.
- Routes may call services.
- Services may call repositories and models.
- Repositories may call models.
- Lower layers must not import higher layers.
- Persist all task entities and mutable state in SQLite.
- Create the SQLite schema automatically on server startup.
- Do not use in-memory-only storage for persisted entities.
`,
  L3: `## Structural Constraints

- Follow a layered architecture.
- Keep routes, services, repositories, and models in separate directories.
- Routes may call services.
- Services may call repositories and models.
- Repositories may call models.
- Lower layers must not import higher layers.
- Persist all task entities and mutable state in SQLite.
- Create the SQLite schema automatically on server startup.
- Use Sequelize for all model definitions and data access.
- Do not use raw SQL as the primary data-access mechanism.
`,
};

// Shared architectural boundary rules, in plain English. These are identical
// between the `prose` and `shape` conditions; only `shape` additionally asks
// for the Shape DSL contract. This nesting (baseline subset prose subset shape)
// lets analysis attribute any effect to the DSL specifically.
const architectureRules = `- Express route handlers belong to the routes layer.
- Business logic and orchestration belong to the services layer.
- Database access belongs to the repositories layer.
- Sequelize model definitions or domain model helpers belong to the models layer.
- SQLite initialization and connection setup belong to the persistence layer.
- Route handlers must not query SQLite or Sequelize directly; they go through
  services.
- Services must not import Express route modules.
- Repositories must not import Express route modules or service modules.
- Lower layers must not import higher layers.`;

export const proseGuidance = `## Architecture Contract (prose)

Keep the implementation consistent with these architectural boundaries:

${architectureRules}

Before finishing, inspect the code against these rules and fix any mismatch.
`;

// The canonical Shape contract. This is the exact text agents are asked to
// author; it passes \`shp fmt --check\` and \`shp check\` against shp 0.3.0.
// (Persistence is a resource, not a component: \`provides\` targets must be
// resources. The previous benchmark contract failed both checks.)
export const shapeContract = `resource Persistence

component ApplicationServices {
}

component DataRepositories {
}

component DomainModels {
}

component HttpRoutes {
}

relation RepositoriesUseModels {
  kind calls
  connects DataRepositories -> DomainModels
}

relation RepositoriesUsePersistence {
  kind provides
  connects DataRepositories -> Persistence
}

relation RoutesCallServices {
  kind calls
  connects HttpRoutes -> ApplicationServices
}

relation ServicesCallRepositories {
  kind calls
  connects ApplicationServices -> DataRepositories
}

rule no_runtime_control_cycle {
  forbid hypercycle over calls or callbacks
}
`;

export const shapeGuidance = `## Architecture Contract (prose)

Keep the implementation consistent with these architectural boundaries:

${architectureRules}

## Shape Contract

Use Shape as an explicit, machine-checkable architecture contract while
generating the backend. Create a file at \`shape/architecture.shape\` with
exactly this model and keep the code consistent with it:

\`\`\`shape
${shapeContract.trim()}
\`\`\`

Map the generated implementation to this contract:

- Express route handlers map to \`HttpRoutes\`.
- Business logic and orchestration map to \`ApplicationServices\`.
- Database access maps to \`DataRepositories\`.
- Sequelize model definitions or domain model helpers map to \`DomainModels\`.
- SQLite initialization and connection setup map to the \`Persistence\` resource.

The contract is validated with \`shp check\` and \`shp fmt --check\`. Before
finishing, ensure \`shape/architecture.shape\` is present and unmodified from the
model above, and inspect the code against the contract to fix any mismatch.
`;
