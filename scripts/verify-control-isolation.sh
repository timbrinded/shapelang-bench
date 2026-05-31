#!/usr/bin/env bash
# Empirically confirm the CONTROL arm cannot see ShapeLang. Runs a Codex agent
# with the SAME isolated CODEX_HOME the harness uses (no skills dir), asking it to
# list any 'shape' skills/tools it has. Expect it to report none. Requires a
# usable model (set MODEL). Run this before trusting a control run.
set -u
MODEL=${MODEL:-gpt-5.3-codex-spark}
t=$(mktemp -d /tmp/control-iso.XXXXXX)
mkdir -p "$t/work" "$t/codex-home"
cp ~/.codex/auth.json "$t/codex-home/auth.json" 2>/dev/null || true

echo "List every skill or tool available to you whose name relates to 'shape' or 'shapelang'. If you have none, reply exactly: NO_SHAPE_SKILLS. Do not write files." \
  | timeout 120 env HOME="$t" CODEX_HOME="$t/codex-home" \
    codex exec --model "$MODEL" --ignore-user-config --ephemeral \
    --skip-git-repo-check --sandbox read-only -C "$t/work" 2>&1 | tee "$t/out.txt"

echo
if grep -qiE 'NO_SHAPE_SKILLS|no .*shape|none' "$t/out.txt" && ! grep -qiE 'shp check|shape/.*\.shape|shape-lang skill (is )?available' "$t/out.txt"; then
  echo "CONTROL ISOLATION: PASS (no ShapeLang visible to the control)"
else
  echo "CONTROL ISOLATION: REVIEW the output above — the control may be seeing ShapeLang"
fi
rm -rf "$t"
