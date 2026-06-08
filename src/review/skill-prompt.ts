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
        `reviewer can trace an invariant to the concrete function/file it governs. Cover the architecture ` +
        `BROADLY: first enumerate every architecture-significant subsystem, then author grounded invariants ` +
        `for EACH (be efficient per subsystem — sample, don't read every file — but exhaustive across ` +
        `subsystems; thin coverage leaves most PRs ungrounded). Author purely from the general architecture, ` +
        `never targeting any specific change. Validate with \`shp fmt --check\` and \`shp check\`.`,
    ),
  ].join("");
}

// Phase 2: review a PR diff and emit review.json. In the shape condition a
// whole-codebase Shape model is mounted at ./shape and traversed PULL-style by
// the agent (no pre-injected context blob — avoids lost-in-the-middle dilution).
const OUTPUT_CONTRACT = `Write your review to ./review.json as:
{"comments": [{"path": "relative/file.ext", "line": 42, "body": "one concrete issue"}]}
Each comment must be a single, specific bug/correctness/security issue at a real changed line.
Do not include style nitpicks, summaries, or praise. No defects → {"comments": []}.`;

// FIXED baseline control — never edit this; it is the stable yardstick the shape
// skill is measured against. Diff-only, no Shape, no model.
const BASELINE_REVIEWER = `You are a rigorous senior code reviewer. Review the pull-request diff for REAL defects:
logic errors, null/None/undefined dereferences, off-by-one, incorrect conditionals, error handling,
concurrency/races, resource leaks, security issues, and incorrect API/contract usage.
Report only concrete, specific bugs at real changed lines. Verify each before reporting — prefer
precision; do not speculate. One issue per comment; no style nitpicks, no praise, no summaries.`;

export async function buildReviewPrompt(
  pr: PrSpec,
  diff: string,
  condition: "baseline" | "shape",
  // When set (shape condition only), use this skill body verbatim instead of the
  // on-disk skills/shape-review/SKILL.md. This is the seam the fan-out harness
  // uses to benchmark many skill variants in one sweep without touching the file.
  skillBody?: string,
): Promise<string> {
  const prSection = section("PULL REQUEST", `Repository: ${pr.repo}\nPR #${pr.prNumber}: ${pr.goldenUrl}`);
  const diffSection = section("DIFF", `\`\`\`diff\n${diff}\n\`\`\``);

  if (condition === "baseline") {
    return [
      section("TASK: CODE REVIEW (baseline control)", BASELINE_REVIEWER),
      prSection,
      diffSection,
      section("OUTPUT CONTRACT", OUTPUT_CONTRACT),
    ].join("");
  }

  // shape: the evolving skill (the optimization target) + mounted model.
  const [diskSkill, skill, cli] = await Promise.all([
    skillBody === undefined ? ourSkill("shape-review") : Promise.resolve(""),
    upstreamSkill(),
    upstreamReference("cli-workflows"),
  ]);
  const wrapper = skillBody ?? diskSkill;
  const note =
    "A whole-codebase Shape model is mounted at ./shape (a real directory) and the `shp` CLI is on " +
    "PATH. Use it on EVERY review per the skill below — it is the optimization target.";
  return [
    section("TASK: SHAPE-REVIEW SKILL (Phase 2, scored)", wrapper),
    section("UPSTREAM SKILL: shape-lang/SKILL.md", skill),
    section("UPSTREAM REFERENCE: cli-workflows.md", cli),
    section("ENVIRONMENT", note),
    prSection,
    diffSection,
    section("OUTPUT CONTRACT", OUTPUT_CONTRACT),
  ].join("");
}

// Phase 2, shape Call B: given the baseline reviewer's findings, augment with
// cross-object bugs only the Shape model reveals. Output ONLY additional findings.
export async function buildShapeAugmentPrompt(
  pr: PrSpec,
  diff: string,
  prior: ReviewComment[],
): Promise<string> {
  const [skill, upstream, cli] = await Promise.all([
    ourSkill("shape-review"),
    upstreamSkill(),
    upstreamReference("cli-workflows"),
  ]);
  const priorJson = JSON.stringify(
    { comments: prior.map((c) => ({ path: c.path, line: c.line, body: c.body })) },
    null,
    2,
  );
  return [
    section("TASK: SHAPE AUGMENTATION PASS (Phase 2, scored)", skill),
    section("UPSTREAM SKILL: shape-lang/SKILL.md", upstream),
    section("UPSTREAM REFERENCE: cli-workflows.md", cli),
    section(
      "ENVIRONMENT",
      "A whole-codebase Shape model is mounted at ./shape (real dir); the `shp` CLI is on PATH. Use it.",
    ),
    section("PULL REQUEST", `Repository: ${pr.repo}\nPR #${pr.prNumber}: ${pr.goldenUrl}`),
    section("DIFF", `\`\`\`diff\n${diff}\n\`\`\``),
    section("BASELINE FINDINGS (verify each: keep real bugs, drop false positives)", priorJson),
    section(
      "OUTPUT CONTRACT",
      'Write the FINAL review to ./review.json as {"comments":[{"path":"file","line":42,"body":"issue"}]}. ' +
        "It MUST contain: every baseline finding that is a real bug (drop one only with concrete evidence " +
        "it is not real), PLUS any cross-object bugs the baseline missed, grounded in the Shape model. " +
        "De-duplicate. No speculation/style. If after verification there are genuinely no real bugs, " +
        'write {"comments": []}.',
    ),
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
