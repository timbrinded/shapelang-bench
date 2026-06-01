EVALUATION_PIPELINE_PYTHON_TEMPLATE = """## Evaluation Pipeline

After you are done, your code will be evaluated automatically as follows:

1. `uv pip install --system -r requirements.txt`
2. `chmod +x run.sh`
3. `./run.sh` (starts your server in background)
4. A health-check will poll `GET http://localhost:{port}/api/health-check` until it returns 200.
5. A Postman test suite will run against `http://localhost:{port}/api` to verify API compliance.

If any of these steps fail, the evaluation fails. Make sure:
- `requirements.txt` contains all dependencies (including {framework} itself).
- `run.sh` starts the server in the foreground (not daemonized).
- The server is fully ready to accept requests when it starts listening.
"""

EVALUATION_PIPELINE_NODE_TEMPLATE = """## Evaluation Pipeline

After you are done, your code will be evaluated automatically as follows:

1. `npm install`
2. `chmod +x run.sh`
3. `./run.sh` (starts your server in background)
4. A health-check will poll `GET http://localhost:{port}/api/health-check` until it returns 200.
5. A Postman test suite will run against `http://localhost:{port}/api` to verify API compliance.

If any of these steps fail, the evaluation fails. Make sure:
- `package.json` contains all dependencies (including {framework} itself).
- `run.sh` starts the server in the foreground (not daemonized).
- The server is fully ready to accept requests when it starts listening.
"""

EVALUATION_PIPELINE_TS_TEMPLATE = """## Evaluation Pipeline

After you are done, your code will be evaluated automatically as follows:

1. `npm install`
2. `chmod +x run.sh`
3. `./run.sh` (starts your server in background)
4. A health-check will poll `GET http://localhost:{port}/api/health-check` until it returns 200.
5. A Postman test suite will run against `http://localhost:{port}/api` to verify API compliance.

If any of these steps fail, the evaluation fails. Make sure:
- `package.json` contains all dependencies (including {framework} itself).
- `run.sh` starts the server in the foreground (not daemonized); it may run via `tsx`/`ts-node` or a compiled build.
- The server is fully ready to accept requests when it starts listening.
"""

EVALUATION_PIPELINE_GO_TEMPLATE = """## Evaluation Pipeline

After you are done, your code will be evaluated automatically as follows:

1. `go mod download && go build ./...`
2. `chmod +x run.sh`
3. `./run.sh` (starts your server in background)
4. A health-check will poll `GET http://localhost:{port}/api/health-check` until it returns 200.
5. A Postman test suite will run against `http://localhost:{port}/api` to verify API compliance.

If any of these steps fail, the evaluation fails. Make sure:
- `go.mod` contains all dependencies (including {framework} itself).
- `run.sh` starts the server in the foreground (not daemonized).
- The server is fully ready to accept requests when it starts listening.
"""

EVALUATION_PIPELINE_RUST_TEMPLATE = """## Evaluation Pipeline

After you are done, your code will be evaluated automatically as follows:

1. `cargo build --release`
2. `chmod +x run.sh`
3. `./run.sh` (starts your server in background)
4. A health-check will poll `GET http://localhost:{port}/api/health-check` until it returns 200.
5. A Postman test suite will run against `http://localhost:{port}/api` to verify API compliance.

If any of these steps fail, the evaluation fails. Make sure:
- `Cargo.toml` contains all dependencies (including {framework} itself).
- `run.sh` starts the server in the foreground (not daemonized).
- The server is fully ready to accept requests when it starts listening.
"""
