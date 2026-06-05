#!/usr/bin/env bash
# Build the `shp` CLI from the vendored shapelang branch (external/shapelang) into
# a self-contained host binary with bundled tree-sitter parsers, so the benchmark
# runs the branch's fixes with no network and no bench-side parser hacks.
# Re-run this after pulling new shapelang fixes onto the branch.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SL="$ROOT/external/shapelang"
OUT="$ROOT/external/shp-build"

if ! command -v zstd >/dev/null 2>&1; then
  echo "error: zstd is required to extract tree-sitter parser bundles" >&2
  exit 1
fi

cd "$SL"

# Embedded native tree-sitter binding assets (.node), resolved to absolute paths.
# (bash 3.2 compatible — no mapfile.)
NATIVE_ASSETS=()
while IFS= read -r line; do
  [ -n "$line" ] && NATIVE_ASSETS+=("$line")
done < <(bun -e '
import { treeSitterNativePackageSpecifiers } from "./packages/shp-checker/src/ast-generation.ts";
import { createRequire } from "node:module";
const req = createRequire(process.cwd() + "/packages/shp-checker/src/ast-generation.ts");
for (const spec of treeSitterNativePackageSpecifiers()) console.log(req.resolve(spec));
')

# Host bun target + release asset name (selects the right parser bundle).
read -r HOST_TARGET HOST_NAME < <(bun -e '
import { TREE_SITTER_NATIVE_BINDING_TARGETS } from "./packages/shp-checker/src/ast-generation.ts";
const plat = process.platform, arch = process.arch;
const name = plat === "darwin" ? `shp-darwin-${arch}`
  : plat === "linux" ? `shp-linux-${arch === "arm64" ? "arm64" : "x64"}`
  : null;
const t = name && TREE_SITTER_NATIVE_BINDING_TARGETS.find((x) => x.releaseName === name);
if (!t) { console.error(`no shp build target for ${plat}-${arch}`); process.exit(1); }
console.log(`${t.bunTarget}\t${t.releaseName}`);
')

rm -rf "$OUT"
mkdir -p "$OUT"

bun build "$SL/packages/shp-cli/src/index.ts" "${NATIVE_ASSETS[@]}" \
  --compile \
  --asset-naming="[name].[ext]" \
  --target="$HOST_TARGET" \
  --outfile="$OUT/shp"
chmod +x "$OUT/shp" 2>/dev/null || true

# Place per-language parser libs next to the binary (shp finds them via
# dirname(execPath)/tree-sitter-language-pack), so it works fully offline.
bun "$SL/scripts/prepare-tree-sitter-parser-assets.ts" --release-name "$HOST_NAME" --out-dir "$OUT"

echo "built $OUT/shp ($HOST_NAME, target $HOST_TARGET)"
