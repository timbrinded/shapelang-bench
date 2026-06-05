import { exists, joinPath, readText } from "../bun-utils.ts";
import { shapelangSkillDir, skillsDir } from "./config.ts";
import type { PrSpec, ReviewComment } from "./types.ts";

async function readMaybe(path: string): Promise<string> {
  return (await exists(path)) ? readText(path) : "";
}

// The upstream shape-lang skill, inlined verbatim so the agent works from a
// faithful replica rather than an ad-hoc paraphrase.
export function upstreamSkill(): Promise<string> {
  return readMaybe(joinPath(shapelangSkillDir, "SKILL.md"));
}

export function upstreamReference(name: string): Promise<string> {
  return readMaybe(joinPath(shapelangSkillDir, "references", `${name}.md`));
}

// One of our authored skills (the optimization target): skills/<name>/SKILL.md.
export function ourSkill(name: "shape-index" | "shape-review"): Promise<string> {
  return readMaybe(joinPath(skillsDir, name, "SKILL.md"));
}

function section(title: string, body: string): string {
  return body.trim() ? `\n\n===== ${title} =====\n\n${body.trim()}\n` : "";
}

// Phase 1: author higher-level architecture/invariant shapes on top of the
// already-generated whole-codebase AST context.
export async function buildIndexPrompt(pr: PrSpec, indexedFiles: number): Promise<string> {
  const [wrapper, skill, cli, makeShape] = await Promise.all([
    ourSkill("shape-index"),
    upstreamSkill(),
    upstreamReference("cli-workflows"),
    upstreamReference("make-shape-protocol"),
  ]);
  return [
    section("TASK: SHAPE-INDEX SKILL (Phase 1, preparation)", wrapper),
    section("UPSTREAM SKILL: shape-lang/SKILL.md", skill),
    section("UPSTREAM REFERENCE: cli-workflows.md", cli),
    section("UPSTREAM REFERENCE: make-shape-protocol.md", makeShape),
    section(
      "TARGET & SCOPE",
      `Repository: ${pr.repo} (full checkout at the PR base commit; working directory is the repo root).\n` +
        `Layer 1 is DONE: deterministic AST-derived Shape context for ${indexedFiles} source files already exists under ` +
        `\`shape/generated/ast/\` (concrete per-function effects/anchors with source refs).\n\n` +
        `Your job (Layer 2): AUTHOR higher-level architecture shapes under \`shape/\` (NOT under \`shape/generated/\`) that ` +
        `the generated AST cannot express — components and their responsibilities, code boundaries / allowed dependencies, ` +
        `owned resources, key business logic, and especially the INVARIANTS that must hold (security/permission rules, ` +
        `data-integrity and transactional constraints, contracts between modules). Ground each authored claim in the ` +
        `generated AST by referencing the relevant generated resources/anchors (relations and/or \`source\` refs) so a ` +
        `reviewer can trace an invariant to the concrete function/file it governs. Be selective — cover the ` +
        `architecture-significant areas, not every file. Validate with \`shp fmt --check\` and \`shp check\`.`,
    ),
  ].join("");
}

// Phase 2: review a PR diff and emit review.json. In the shape condition a
// whole-codebase Shape model is mounted at ./shape and traversed PULL-style by
// the agent (no pre-injected context blob — avoids lost-in-the-middle dilution).
export async function buildReviewPrompt(
  pr: PrSpec,
  diff: string,
  condition: "baseline" | "shape",
): Promise<string> {
  const [wrapper, skill, cli] = await Promise.all([
    ourSkill("shape-review"),
    upstreamSkill(),
    upstreamReference("cli-workflows"),
  ]);
  const outputContract = `Write your review to ./review.json as:
{"comments": [{"path": "relative/file.ext", "line": 42, "body": "one concrete issue"}]}
Each comment must be a single, specific bug/correctness/security issue at a real changed line.
Do not include style nitpicks, summaries, or praise.`;
  const conditionNote =
    condition === "shape"
      ? "shape: a whole-codebase Shape model is mounted at ./shape (a real directory) and the `shp` CLI " +
        "is on PATH. It is LARGE — do NOT read it all. You MUST traverse it with `shp`: start with " +
        "`shp graph --stats`, then for the diff's changed symbols and their dependencies run " +
        "`shp explain <Symbol>` and `shp graph <Symbol> --kind calls` to pull declared effects, " +
        "invariants, contracts, and callers the diff doesn't show. (You may also read specific " +
        "./shape/**/*.shape files, but shp graph/explain are required.) Pull only what is relevant."
      : "baseline: no Shape model is available; review from the diff alone.";
  return [
    section("TASK: SHAPE-REVIEW SKILL (Phase 2, scored)", wrapper),
    section("UPSTREAM SKILL: shape-lang/SKILL.md", skill),
    section("UPSTREAM REFERENCE: cli-workflows.md", cli),
    section("CONDITION", conditionNote),
    section("PULL REQUEST", `Repository: ${pr.repo}\nPR #${pr.prNumber}: ${pr.goldenUrl}`),
    section("DIFF", `\`\`\`diff\n${diff}\n\`\`\``),
    section("OUTPUT CONTRACT", outputContract),
  ].join("");
}

// Parse the agent's review.json (tolerant of a bare array or a {comments:[...]}).
export function parseReviewComments(raw: string): ReviewComment[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { comments?: unknown }).comments)
      ? (data as { comments: unknown[] }).comments
      : [];
  const comments: ReviewComment[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const body = typeof record.body === "string" ? record.body : "";
    if (!body.trim()) continue;
    comments.push({
      path: typeof record.path === "string" ? record.path : null,
      line: typeof record.line === "number" ? record.line : null,
      body,
      created_at: null,
    });
  }
  return comments;
}
