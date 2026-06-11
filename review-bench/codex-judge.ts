import {
  exists,
  joinPath,
  makeDir,
  readText,
  removePath,
  runProcess,
  writeText,
} from "../src/bun-utils.ts";

// Martian's verbatim judge prompt (step3_judge_comments.JUDGE_PROMPT). Kept
// identical so a Codex-driven judge is methodologically the same decision as
// Martian's hosted judge — only the engine (Codex subscription) differs.
const JUDGE_PROMPT = `You are evaluating AI code review tools.
Determine if the candidate issue matches the golden (expected) comment.

Golden Comment (the issue we're looking for):
{golden}

Candidate Issue (from the tool's review):
{candidate}

Instructions:
- Determine if the candidate identifies the SAME underlying issue as the golden comment
- Accept semantic matches - different wording is fine if it's the same problem
- Focus on whether they point to the same bug, concern, or code issue

Respond with ONLY a JSON object:
{"reasoning": "brief explanation", "match": true/false, "confidence": 0.0-1.0}`;

// NUL — cannot appear in comment text, so `${golden}${PAIR_DELIMITER}${candidate}`
// keys never collide across different pairs.
export const PAIR_DELIMITER = "\u0000";

export type CodexJudgeOptions = {
  model: string;
  codexHome: string; // CODEX_HOME with subscription auth.json
  cwd: string; // a stable scratch dir for read-only runs
  concurrency: number;
  timeoutMs: number;
  cache: Map<string, boolean>; // persisted verdict cache (by model+pair hash)
};

export function cacheKey(model: string, golden: string, candidate: string): string {
  return `${model}${PAIR_DELIMITER}${Bun.hash(golden + PAIR_DELIMITER + candidate).toString(36)}`;
}

// Robustly pull the verdict object out of the model's final message.
export function extractVerdict(text: string): { match?: boolean; confidence?: number } | null {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  const candidates: string[] = [trimmed];
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length) candidates.push(lines[lines.length - 1]!);
  const braces = trimmed.match(/\{[^{}]*\}/g);
  if (braces) candidates.push(braces[braces.length - 1]!);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        return parsed as { match?: boolean; confidence?: number };
      }
    } catch {
      // try next
    }
  }
  return null;
}

// One judge call via `codex exec` (subscription auth, read-only sandbox). Mirrors
// src/run-codex.ts flags so it uses the same proven CLI surface.
//
// CRITICAL: a usage-limited / timed-out / crashed call returns EMPTY output. That
// is NOT a "no match" verdict — returning false for it both scores real matches as
// misses AND (because the caller caches verdicts) POISONS the cache with a bogus
// false that survives the limit reset. So we THROW on empty output (tagged when the
// stderr looks like a usage limit) and only return a boolean when the model
// actually produced a parseable response. One retry absorbs a transient blip; a
// real usage limit persists and surfaces honestly.
async function runJudge(prompt: string, opts: CodexJudgeOptions): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const outFile = joinPath(Bun.env.TMPDIR ?? "/tmp", `shp-judge-${crypto.randomUUID()}.txt`);
    const result = await runProcess(
      "codex",
      [
        "exec",
        "--model",
        opts.model,
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--output-last-message",
        outFile,
        "-C",
        opts.cwd,
      ],
      {
        cwd: opts.cwd,
        env: { ...Bun.env, HOME: opts.codexHome, CODEX_HOME: opts.codexHome, PATH: Bun.env.PATH ?? "" },
        stdin: prompt,
        timeoutMs: opts.timeoutMs,
      },
    );
    let output = "";
    if (await exists(outFile)) {
      output = await readText(outFile);
      await removePath(outFile);
    }
    if (!output) output = result.stdout;

    if (output.trim()) {
      // The model produced a response — parse it. An unparseable-but-present
      // response is a genuine (reproducible) "no match", safe to cache.
      const verdict = extractVerdict(output);
      return verdict?.match === true;
    }

    // Empty output: failed call. Retry once for a transient blip; otherwise throw.
    if (attempt === 2) {
      const err = result.stderr.trim();
      const rateLimited = /usage limit|rate.?limit|not supported|quota/i.test(err);
      throw new Error(
        `judge produced no output${rateLimited ? " [USAGE-LIMIT/MODEL]" : ""} ` +
          `(code=${result.code}${result.timedOut ? ",timedOut" : ""}; stderr: ${err.slice(-200).replace(/\s+/g, " ")})`,
      );
    }
  }
  // Unreachable (loop either returns or throws), but satisfies the type checker.
  throw new Error("judge: unreachable");
}

async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function next(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]!);
    }
  }
  const lanes = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: lanes }, next));
}

// Set up a CODEX_HOME for the judge with the user's subscription auth copied in.
export async function ensureJudgeHome(runsDir: string): Promise<{ codexHome: string; cwd: string }> {
  const codexHome = joinPath(runsDir, "judge-home");
  const cwd = joinPath(runsDir, "judge-cwd");
  await makeDir(codexHome);
  await makeDir(cwd);
  const authSource = Bun.env.CODEX_AUTH_FILE ?? joinPath(Bun.env.HOME ?? "", ".codex", "auth.json");
  if (!(await exists(authSource))) {
    throw new Error(
      `Codex auth not found at ${authSource}. Log in with the Codex CLI, or set CODEX_AUTH_FILE to a chatgpt auth.json.`,
    );
  }
  await writeText(joinPath(codexHome, "auth.json"), await readText(authSource));
  return { codexHome, cwd };
}

// Judge every (golden, candidate) pair for one review. Returns the set of
// `${golden}${PAIR_DELIMITER}${candidate}` keys that matched, using + filling the cache.
export async function judgePairs(
  golden: string[],
  candidates: string[],
  opts: CodexJudgeOptions,
): Promise<Set<string>> {
  type Pair = { golden: string; candidate: string; key: string; cacheId: string };
  const pairs: Pair[] = [];
  const matched = new Set<string>();

  for (const g of golden) {
    for (const c of candidates) {
      const key = `${g}${PAIR_DELIMITER}${c}`;
      const cacheId = cacheKey(opts.model, g, c);
      const cached = opts.cache.get(cacheId);
      if (cached !== undefined) {
        if (cached) matched.add(key);
        continue;
      }
      pairs.push({ golden: g, candidate: c, key, cacheId });
    }
  }

  await pool(pairs, opts.concurrency, async (pair) => {
    const prompt = JUDGE_PROMPT.replace("{golden}", pair.golden).replace("{candidate}", pair.candidate);
    const isMatch = await runJudge(prompt, opts);
    opts.cache.set(pair.cacheId, isMatch);
    if (isMatch) matched.add(pair.key);
  });

  return matched;
}
