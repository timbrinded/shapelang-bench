{{OPENAPI}}

Generate a complete Node.js 24 REST API server compliant with the OpenAPI
specification above.

## Requirements

- Use JavaScript only. Do not require a TypeScript build step.
- Use the `express` npm package for HTTP routing. Declare `express` in
  `package.json` dependencies with a normal semver range and import or require it
  from application code.
- Work only in the current directory.
- Create a `package.json` with a `start` script.
- Use normal npm registry dependencies with semver ranges. Do not use `file:`
  dependencies, vendored dependency paths, local package aliases, or registry
  overrides.
- Do not create or edit `node_modules`. Dependencies must be installed by
  `bun install` from `package.json`.
- The `start` script must run your actual server entry file with Bun. The path
  in the script must match where you place the entry file (e.g. if your entry is
  `src/server.js`, the script must be `bun src/server.js`, not `bun server.js`).
  Do not use `node` in the start script.
- The server must listen on `process.env.PORT`, defaulting to `3137` when the
  environment variable is unset.
- The server entrypoint must call `app.listen(...)` at top level when
  `bun run start` executes. Do not hide server startup behind
  `require.main === module`, and do not export the Express app as the default
  server value.
- All API routes must be prefixed with `/api`.
- `GET /api/health-check` must return HTTP 200.
- Use JSON request and response bodies unless a task-specific rule says
  otherwise.
- Implement all behavior from the OpenAPI specification.

{{CONSTRAINTS}}

{{TASK_DETAILS}}

## Evaluation

The evaluator will:

1. Run `bun install` in the generated directory.
2. Run `bun run start`.
3. Poll `GET /api/health-check`.
4. Execute black-box HTTP tests against the API.

Finish only after the implementation is ready to run with those commands.
