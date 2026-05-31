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

