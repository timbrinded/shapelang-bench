MANDATORY_FILES_PYTHON_TEMPLATE = """## Mandatory Files

1. **`requirements.txt`** - all pip dependencies needed to run the server. Do NOT invent unexisting versions; when in doubt prefer `>=` versions.
2. **`run.sh`** - a shell script that starts the server. Must be a valid bash script.
"""

MANDATORY_FILES_NODE_TEMPLATE = """## Mandatory Files

1. **`package.json`** - all npm dependencies needed to run the server. Do NOT invent nonexistent package versions; when in doubt omit the version or use `>=`.
2. **`run.sh`** - a shell script that starts the server. Must be a valid bash script.
"""

MANDATORY_FILES_TS_TEMPLATE = """## Mandatory Files

1. **`package.json`** - all npm dependencies needed to run the server (including TypeScript tooling). Do NOT invent nonexistent package versions; when in doubt omit the version or use `>=`.
2. **`tsconfig.json`** - the TypeScript compiler configuration.
3. **`run.sh`** - a shell script that starts the server. Must be a valid bash script.
"""

MANDATORY_FILES_GO_TEMPLATE = """## Mandatory Files

1. **`go.mod`** - the Go module file declaring all dependencies needed to run the server. Do NOT invent nonexistent module versions; when in doubt use the latest stable version.
2. **`run.sh`** - a shell script that starts the server. Must be a valid bash script.
"""

MANDATORY_FILES_RUST_TEMPLATE = """## Mandatory Files

1. **`Cargo.toml`** - the Cargo manifest declaring all crate dependencies needed to run the server. Do NOT invent nonexistent crate versions; when in doubt use the latest stable version.
2. **`run.sh`** - a shell script that starts the server. Must be a valid bash script.
"""
