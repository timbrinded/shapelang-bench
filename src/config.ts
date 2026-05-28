import { joinPath, pathFromImport } from "./bun-utils.ts";

export const harnessDir = pathFromImport(import.meta.url, "..");

export const repoRoot = harnessDir;
export const promptsDir = joinPath(harnessDir, "prompts");
export const runsDir = joinPath(harnessDir, "runs");
export const tasksDir = joinPath(harnessDir, "tasks");
export const defaultPort = 3137;
export const bunBin = Bun.env.BUN_BIN ?? "bun";

export const levels = ["L0", "L1", "L2", "L3"];
export const conditions = ["baseline", "shape"];
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

export const shapeGuidance = `## Shape Contract

Use Shape as an explicit architecture contract while generating the backend.
Create a file at \`shape/architecture.shape\` with this model and keep the code
consistent with it:

\`\`\`shape
component HttpRoutes {
}

component ApplicationServices {
}

component DataRepositories {
}

component DomainModels {
}

component Persistence {
}

relation RoutesCallServices {
  kind calls
  connects HttpRoutes -> ApplicationServices
}

relation ServicesCallRepositories {
  kind calls
  connects ApplicationServices -> DataRepositories
}

relation RepositoriesUseModels {
  kind calls
  connects DataRepositories -> DomainModels
}

relation RepositoriesUsePersistence {
  kind provides
  connects DataRepositories -> Persistence
}

rule no_runtime_control_cycle {
  forbid hypercycle over calls or callbacks
}
\`\`\`

Map the generated implementation to this contract:

- Express route handlers belong to \`HttpRoutes\`.
- Business logic and orchestration belong to \`ApplicationServices\`.
- Database access belongs to \`DataRepositories\`.
- Sequelize model definitions or domain model helpers belong to \`DomainModels\`.
- SQLite initialization and connection setup belong to \`Persistence\`.
- Route handlers must not query SQLite or Sequelize directly.
- Services must not import Express route modules.
- Repositories must not import Express route modules or service modules.
- Before finishing, inspect the code against the Shape contract and fix any
  mismatch.
`;
