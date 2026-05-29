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
    requirements: `- Use Python 3.12 only.
- Use FastAPI for HTTP routing and Uvicorn for serving HTTP.
- Work only in the current directory.
- Use uv for Python dependency and environment management.
- Create a \`pyproject.toml\` with a \`[project]\` table,
  \`name = "candidate-api"\`, \`version = "0.1.0"\`,
  \`requires-python = ">=3.12,<3.13"\`, and a \`dependencies = [...]\` list
  inside \`[project]\`.
- Set \`[tool.uv] package = false\` because this is an application, not an
  installable Python package.
- Include \`fastapi\` and \`uvicorn[standard]\` in the \`[project]\`
  dependency list.
- Do not create \`requirements.txt\`, Pipfile, Poetry files, vendored
  dependencies, or a virtual environment by hand. uv may create \`.venv\` if
  you run \`uv sync\`; do not edit or vendor that directory.
- Create a top-level \`server.py\`.
- The evaluator will run \`uv sync --python 3.12\`, then
  \`.venv/bin/python server.py\`; that command must start the HTTP server
  without additional arguments.
- The server must listen on \`os.environ["PORT"]\`, defaulting to \`3137\` when
  the environment variable is unset.
- All API routes must be prefixed with \`/api\`.
- \`GET /api/health-check\` must return HTTP 200.
- Use JSON request and response bodies unless a task-specific rule says
  otherwise.
- FastAPI endpoint parameters with defaults, including optional headers and
  dependencies, must come after non-default parameters. Put \`Response\` or
  required body/path parameters before optional header parameters.
- For optional FastAPI headers with \`Annotated\`, write
  \`authorization: Annotated[str | None, Header()] = None\`. Do not put
  \`default=\` inside \`Header(...)\` when \`Header\` is inside \`Annotated\`.
- Never use \`import *\` inside a function.
- Before finishing, run \`uv sync --python 3.12\` and a Python syntax check such
  as \`.venv/bin/python -m py_compile $(find . -name '*.py' -not -path './.venv/*')\`;
  fix any failures.
- Implement all behavior from the OpenAPI specification.`,
    evaluation: `1. Run \`uv sync --python 3.12\`.
2. Run \`.venv/bin/python server.py\`.
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
- Declare \`sqlalchemy\` in the \`[project]\` dependency list.
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
- \`go.mod\` must declare a module name and a \`go\` directive. It is acceptable
  for \`go.mod\` to contain only those lines when third-party packages are used;
  the evaluator runs \`go mod tidy\` to resolve imports.
- Use normal Go module dependencies. Do not vendor dependencies and do not
  hand-pin guessed or fictional module versions.
- The evaluator will run \`go run .\`; that command must start the HTTP server
  without additional arguments.
- The server must listen on \`os.Getenv("PORT")\`, defaulting to \`3137\` when
  the environment variable is unset.
- All API routes must be prefixed with \`/api\`.
- \`GET /api/health-check\` must return HTTP 200.
- Use JSON request and response bodies unless a task-specific rule says
  otherwise.
- Define named request, response, and domain structs and reuse those types across
  helpers. Do not pass anonymous struct types across function boundaries.
- Keep numeric money/count fields on one integer type throughout a calculation.
- Remove unused imports and undefined identifiers before finishing.
- Before finishing, run \`go mod tidy\` and \`go build ./...\`; fix any failures.
- Implement all behavior from the OpenAPI specification.`,
    evaluation: `1. Run \`go mod tidy\`.
2. Run \`go mod download\`.
3. Run \`go build ./...\`.
4. Run \`go run .\`.
5. Poll \`GET /api/health-check\`.
6. Execute black-box HTTP tests against the API.`,
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
- Import \`modernc.org/sqlite\` for its database/sql driver side effect and let
  \`go mod tidy\` resolve the module version.
- Create the SQLite schema automatically on server startup.
- Do not use in-memory-only storage for persisted entities.
`,
      L3: `## Structural Constraints

${sharedLayering}
- Persist all task entities and mutable state in SQLite.
- Create the SQLite schema automatically on server startup.
- Use GORM with \`gorm.io/gorm\` and \`gorm.io/driver/sqlite\` for model
  definitions and data access.
- Import \`gorm.io/gorm\` and \`gorm.io/driver/sqlite\` in code and let
  \`go mod tidy\` resolve valid module versions.
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
    requirements: `- Use stable Rust with Cargo edition 2021.
- Do not create a \`rust-toolchain\` file and do not require nightly Rust.
- Use axum 0.8 for HTTP routing and Tokio 1 for the async runtime.
- Work only in the current directory.
- Create a \`Cargo.toml\` file and a runnable \`src/main.rs\`.
- \`Cargo.toml\` must include a \`[package]\` table, \`edition = "2021"\`, and
  normal crates.io dependencies. Do not vendor dependencies.
- Use one coherent axum version across the project. Avoid mixing examples from
  axum 0.6, 0.7, and 0.8.
- The evaluator will run \`cargo run --quiet\`; that command must start the HTTP
  server without additional arguments.
- The server must listen on \`std::env::var("PORT")\`, defaulting to \`3137\`
  when the environment variable is unset.
- All API routes must be prefixed with \`/api\`.
- \`GET /api/health-check\` must return HTTP 200.
- Use JSON request and response bodies unless a task-specific rule says
  otherwise.
- Every \`mod foo;\` declaration must have a matching \`src/foo.rs\` or
  \`src/foo/mod.rs\` file, and every sibling module import should use
  \`crate::...\` paths.
- Handler return types must be type-consistent. Prefer returning
  \`axum::response::Response\` and ending every branch with
  \`.into_response()\` when branches return different JSON/error shapes.
- Avoid holding overlapping mutable borrows across later mutations; clone IDs or
  split operations into separate scopes before mutating the same state again.
- Before finishing, run \`cargo build --quiet\`; fix any failures.
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
- Declare SQLx as
  \`sqlx = { version = "0.8", features = ["runtime-tokio-rustls", "sqlite"] }\`.
- Create the SQLite schema automatically on server startup.
- Do not use in-memory-only storage for persisted entities.
`,
      L3: `## Structural Constraints

${sharedLayering}
- Persist all task entities and mutable state in SQLite.
- Create the SQLite schema automatically on server startup.
- Use SeaORM with SQLite for entity definitions and data access.
- Declare SeaORM as
  \`sea-orm = { version = "1.1", features = ["sqlx-sqlite", "runtime-tokio-rustls", "macros"] }\`.
- Import the SeaORM traits required by the methods you call, such as
  \`ActiveModelTrait\`, \`ColumnTrait\`, \`ConnectionTrait\`, \`EntityTrait\`,
  \`PaginatorTrait\`, \`QueryFilter\`, \`QueryOrder\`, and \`Set\`.
- Use \`sea_orm::sea_query\` re-exports instead of importing a separate
  \`sea_query\` crate unless you declare that crate explicitly.
- For entities without relations, derive \`DeriveRelation\` on the empty
  \`Relation\` enum so \`RelationTrait\` is implemented.
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
