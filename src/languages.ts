export const languageIds = ["javascript", "python", "go", "rust"];
export const defaultLanguage = "javascript";

export type LanguageId = (typeof languageIds)[number];

type LanguageProfile = {
  label: string;
  candidateKind: string;
  requirements: string;
  evaluation: string;
  constraintBlocks: Record<string, string>;
  shapeMapping: string;
};

const sharedLayering = `- Follow a layered architecture.
- Keep routes, services, repositories, and models in separate directories or
  packages.
- Routes may call services.
- Services may call repositories and models.
- Repositories may call models.
- Lower layers must not import higher layers.`;

export const languageProfiles: Record<LanguageId, LanguageProfile> = {
  javascript: {
    label: "JavaScript / Express",
    candidateKind: "Node.js 24 REST API server",
    requirements: `- Use JavaScript only. Do not require a TypeScript build step.
- Use the \`express\` npm package for HTTP routing. Declare \`express\` in
  \`package.json\` dependencies with a normal semver range and import or require it
  from application code.
- Work only in the current directory.
- Create a \`package.json\` with a \`start\` script.
- Use normal npm registry dependencies with semver ranges. Do not use \`file:\`
  dependencies, vendored dependency paths, local package aliases, or registry
  overrides.
- Do not create or edit \`node_modules\`. Dependencies must be installed by
  \`bun install\` from \`package.json\`.
- The \`start\` script must run the server with Bun, for example
  \`bun server.js\` or \`bun src/server.js\`. Do not use \`node\` in the start script.
- The server must listen on \`process.env.PORT\`, defaulting to \`3137\` when the
  environment variable is unset.
- The server entrypoint must call \`app.listen(...)\` at top level when
  \`bun run start\` executes. Do not hide server startup behind
  \`require.main === module\`, and do not export the Express app as the default
  server value.
- All API routes must be prefixed with \`/api\`.
- \`GET /api/health-check\` must return HTTP 200.
- Use JSON request and response bodies unless a task-specific rule says
  otherwise.
- Implement all behavior from the OpenAPI specification.`,
    evaluation: `1. Run \`bun install\` in the generated directory.
2. Run \`bun run start\`.
3. Poll \`GET /api/health-check\`.
4. Execute black-box HTTP tests against the API.`,
    constraintBlocks: {
      L0: `## Structural Constraints

- No additional structural constraints.
- In-memory storage is allowed.
`,
      L1: `## Structural Constraints

${sharedLayering}
- In-memory storage is allowed.
`,
      L2: `## Structural Constraints

${sharedLayering}
- Persist all task entities and mutable state in SQLite.
- Create the SQLite schema automatically on server startup.
- Do not use in-memory-only storage for persisted entities.
`,
      L3: `## Structural Constraints

${sharedLayering}
- Persist all task entities and mutable state in SQLite.
- Create the SQLite schema automatically on server startup.
- Use Sequelize for all model definitions and data access.
- Do not use raw SQL as the primary data-access mechanism.
`,
    },
    shapeMapping: `- Express route handlers belong to \`HttpRoutes\`.
- Business logic and orchestration belong to \`ApplicationServices\`.
- Database access belongs to \`DataRepositories\`.
- Sequelize model definitions or domain model helpers belong to \`DomainModels\`.
- SQLite initialization and connection setup belong to \`Persistence\`.
- Route handlers must not query SQLite or Sequelize directly.
- Services must not import Express route modules.
- Repositories must not import Express route modules or service modules.`,
  },
  python: {
    label: "Python / FastAPI",
    candidateKind: "Python 3.12 REST API server",
    requirements: `- Use Python only.
- Use FastAPI for HTTP routing and Uvicorn for serving HTTP.
- Work only in the current directory.
- Create a \`requirements.txt\` file with normal PyPI dependency specifiers.
- Include \`fastapi\` and \`uvicorn\` in \`requirements.txt\`.
- Do not vendor dependencies or create a local virtual environment yourself.
- Create a top-level \`server.py\`.
- The evaluator will run \`python server.py\`; that command must start the HTTP
  server without additional arguments.
- The server must listen on \`os.environ["PORT"]\`, defaulting to \`3137\` when
  the environment variable is unset.
- All API routes must be prefixed with \`/api\`.
- \`GET /api/health-check\` must return HTTP 200.
- Use JSON request and response bodies unless a task-specific rule says
  otherwise.
- Implement all behavior from the OpenAPI specification.`,
    evaluation: `1. Create an isolated virtual environment.
2. Run \`python -m pip install -r requirements.txt\`.
3. Run \`python server.py\`.
4. Poll \`GET /api/health-check\`.
5. Execute black-box HTTP tests against the API.`,
    constraintBlocks: {
      L0: `## Structural Constraints

- No additional structural constraints.
- In-memory storage is allowed.
`,
      L1: `## Structural Constraints

${sharedLayering}
- In-memory storage is allowed.
`,
      L2: `## Structural Constraints

${sharedLayering}
- Persist all task entities and mutable state in SQLite using Python's standard
  \`sqlite3\` module.
- Create the SQLite schema automatically on server startup.
- Do not use in-memory-only storage for persisted entities.
`,
      L3: `## Structural Constraints

${sharedLayering}
- Persist all task entities and mutable state in SQLite.
- Create the SQLite schema automatically on server startup.
- Use SQLAlchemy ORM for model definitions and data access.
- Do not use raw SQL as the primary data-access mechanism.
`,
    },
    shapeMapping: `- FastAPI route functions belong to \`HttpRoutes\`.
- Business logic and orchestration belong to \`ApplicationServices\`.
- Database access belongs to \`DataRepositories\`.
- SQLAlchemy model definitions or domain model helpers belong to \`DomainModels\`.
- SQLite initialization and connection setup belong to \`Persistence\`.
- Route handlers must not query SQLite or SQLAlchemy directly.
- Services must not import FastAPI route modules.
- Repositories must not import FastAPI route modules or service modules.`,
  },
  go: {
    label: "Go / net/http",
    candidateKind: "Go REST API server",
    requirements: `- Use Go 1.22 or newer.
- Use the standard library \`net/http\` package and \`http.ServeMux\` for routing.
- Do not use Gin, chi, Echo, Fiber, Gorilla mux, or other HTTP frameworks.
- Work only in the current directory.
- Create a \`go.mod\` file and a runnable \`main.go\`.
- Use normal Go module dependencies. Do not vendor dependencies.
- The evaluator will run \`go run .\`; that command must start the HTTP server
  without additional arguments.
- The server must listen on \`os.Getenv("PORT")\`, defaulting to \`3137\` when
  the environment variable is unset.
- All API routes must be prefixed with \`/api\`.
- \`GET /api/health-check\` must return HTTP 200.
- Use JSON request and response bodies unless a task-specific rule says
  otherwise.
- Implement all behavior from the OpenAPI specification.`,
    evaluation: `1. Run \`go mod download\`.
2. Run \`go build ./...\`.
3. Run \`go run .\`.
4. Poll \`GET /api/health-check\`.
5. Execute black-box HTTP tests against the API.`,
    constraintBlocks: {
      L0: `## Structural Constraints

- No additional structural constraints.
- In-memory storage is allowed.
`,
      L1: `## Structural Constraints

${sharedLayering}
- In-memory storage is allowed.
`,
      L2: `## Structural Constraints

${sharedLayering}
- Persist all task entities and mutable state in SQLite using \`database/sql\`
  with the pure-Go \`modernc.org/sqlite\` driver.
- Create the SQLite schema automatically on server startup.
- Do not use in-memory-only storage for persisted entities.
`,
      L3: `## Structural Constraints

${sharedLayering}
- Persist all task entities and mutable state in SQLite.
- Create the SQLite schema automatically on server startup.
- Use GORM with \`gorm.io/gorm\` and \`gorm.io/driver/sqlite\` for model
  definitions and data access.
- Do not use raw SQL as the primary data-access mechanism.
`,
    },
    shapeMapping: `- net/http handlers and ServeMux route registration belong to \`HttpRoutes\`.
- Business logic and orchestration belong to \`ApplicationServices\`.
- Database access belongs to \`DataRepositories\`.
- GORM model definitions or domain model helpers belong to \`DomainModels\`.
- SQLite initialization and connection setup belong to \`Persistence\`.
- Route handlers must not query SQLite or GORM directly.
- Services must not import HTTP route packages.
- Repositories must not import HTTP route packages or service packages.`,
  },
  rust: {
    label: "Rust / axum",
    candidateKind: "Rust REST API server",
    requirements: `- Use stable Rust.
- Use axum for HTTP routing and Tokio for the async runtime.
- Work only in the current directory.
- Create a \`Cargo.toml\` file and a runnable \`src/main.rs\`.
- Use normal crates.io dependencies. Do not vendor dependencies.
- The evaluator will run \`cargo run --quiet\`; that command must start the HTTP
  server without additional arguments.
- The server must listen on \`std::env::var("PORT")\`, defaulting to \`3137\`
  when the environment variable is unset.
- All API routes must be prefixed with \`/api\`.
- \`GET /api/health-check\` must return HTTP 200.
- Use JSON request and response bodies unless a task-specific rule says
  otherwise.
- Implement all behavior from the OpenAPI specification.`,
    evaluation: `1. Run \`cargo fetch\`.
2. Run \`cargo build --quiet\`.
3. Run \`cargo run --quiet\`.
4. Poll \`GET /api/health-check\`.
5. Execute black-box HTTP tests against the API.`,
    constraintBlocks: {
      L0: `## Structural Constraints

- No additional structural constraints.
- In-memory storage is allowed.
`,
      L1: `## Structural Constraints

${sharedLayering}
- In-memory storage is allowed.
`,
      L2: `## Structural Constraints

${sharedLayering}
- Persist all task entities and mutable state in SQLite using SQLx with the
  \`sqlite\` and Tokio runtime features enabled.
- Create the SQLite schema automatically on server startup.
- Do not use in-memory-only storage for persisted entities.
`,
      L3: `## Structural Constraints

${sharedLayering}
- Persist all task entities and mutable state in SQLite.
- Create the SQLite schema automatically on server startup.
- Use SeaORM with SQLite for entity definitions and data access.
- Do not use raw SQL as the primary data-access mechanism.
`,
    },
    shapeMapping: `- axum routers and handler functions belong to \`HttpRoutes\`.
- Business logic and orchestration belong to \`ApplicationServices\`.
- Database access belongs to \`DataRepositories\`.
- SeaORM entity definitions or domain model helpers belong to \`DomainModels\`.
- SQLite initialization and connection setup belong to \`Persistence\`.
- Route handlers must not query SQLite or SeaORM directly.
- Services must not import axum route modules.
- Repositories must not import axum route modules or service modules.`,
  },
};

export function shapeGuidanceForLanguage(language: LanguageId): string {
  const profile = languageProfiles[language];
  return `## Shape Contract

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

${profile.shapeMapping}
- Before finishing, inspect the code against the Shape contract and fix any
  mismatch.
`;
}
