import type { EvalResult, EvaluationsFile, GoldenComment } from "./types.ts";

// A judge decision: does the candidate describe the same issue as the golden?
export type MatchFn = (golden: string, candidate: string) => boolean;

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((word) => word.length > 3),
  );
}

// Deterministic, LLM-free matcher used ONLY by the hermetic smoke test.
// Two texts "match" when they share at least two significant tokens. This is a
// stand-in for Martian's LLM judge so the smoke test can assert an exact oracle
// without any network or model spend. The real path uses Martian's step3 judge.
export function stubMatch(golden: string, candidate: string): boolean {
  const goldenTokens = tokenize(golden);
  let shared = 0;
  for (const token of tokenize(candidate)) {
    if (goldenTokens.has(token)) shared += 1;
  }
  return shared >= 2;
}

function buildSiblingMap(candidates: string[], groups?: number[][]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!groups) return map;
  for (const group of groups) {
    const texts = new Set<string>();
    for (const index of group) {
      if (index < candidates.length) texts.add(candidates[index]!);
    }
    for (const index of group) {
      if (index >= candidates.length) continue;
      const self = candidates[index]!;
      const siblings = new Set(texts);
      siblings.delete(self);
      map.set(self, siblings);
    }
  }
  return map;
}

// Port of step3_judge_comments.evaluate_review (the deterministic parts). The
// `match` callback replaces the per-pair LLM call; everything else — TP/FP/FN
// accounting and dedup sibling propagation — mirrors the Python exactly so our
// stub-judge numbers match Martian's real judge given the same match decisions.
export function evaluateReview(
  golden: GoldenComment[],
  candidates: string[],
  match: MatchFn,
  dedupGroups?: number[][],
): EvalResult {
  const totalGolden = golden.length;

  if (totalGolden === 0) {
    return {
      skipped: true,
      reason: "No golden comments",
      total_candidates: candidates.length,
      total_golden: 0,
      tp: 0,
      fp: 0,
      fn: 0,
      errors_count: 0,
      precision: 0,
      recall: 0,
    };
  }

  if (candidates.length === 0) {
    return {
      skipped: false,
      total_candidates: 0,
      total_golden: totalGolden,
      tp: 0,
      fp: 0,
      fn: totalGolden,
      errors_count: 0,
      precision: 0,
      recall: 0,
      true_positives: [],
      false_positives: [],
      false_negatives: golden.map((gc) => ({ golden_comment: gc.comment, severity: gc.severity })),
    };
  }

  const goldenMatched = new Map<string, boolean>();
  for (const gc of golden) goldenMatched.set(gc.comment, false);
  const candidateMatched = new Map<string, boolean>();
  for (const candidate of candidates) candidateMatched.set(candidate, false);
  const siblingMap = buildSiblingMap(candidates, dedupGroups);

  for (const gc of golden) {
    for (const candidate of candidates) {
      if (match(gc.comment, candidate)) {
        goldenMatched.set(gc.comment, true);
        candidateMatched.set(candidate, true);
        for (const sibling of siblingMap.get(candidate) ?? []) {
          candidateMatched.set(sibling, true);
        }
      }
    }
  }

  const truePositives: unknown[] = [];
  const falseNegatives: unknown[] = [];
  for (const gc of golden) {
    if (goldenMatched.get(gc.comment)) {
      truePositives.push({ golden_comment: gc.comment, severity: gc.severity });
    } else {
      falseNegatives.push({ golden_comment: gc.comment, severity: gc.severity });
    }
  }
  const falsePositives = [...candidateMatched.entries()]
    .filter(([, matched]) => !matched)
    .map(([candidate]) => ({ candidate }));

  const totalCandidates = candidates.length;
  const tp = truePositives.length;
  const precision = totalCandidates > 0 ? tp / totalCandidates : 0;
  const recall = tp / totalGolden;

  return {
    skipped: false,
    total_candidates: totalCandidates,
    total_golden: totalGolden,
    tp,
    fp: falsePositives.length,
    fn: falseNegatives.length,
    errors_count: 0,
    precision,
    recall,
    true_positives: truePositives,
    false_positives: falsePositives,
    false_negatives: falseNegatives,
  };
}

export type Aggregate = {
  tp: number;
  fp: number;
  fn: number;
  reviews: number;
  precision: number;
  recall: number;
  f1: number;
};

// Aggregate across PRs for one tool. Mirrors step3's printed summary:
// precision = TP/(TP+FP), recall = TP/(TP+FN), F1 = 2PR/(P+R).
export function aggregateTool(evaluations: EvaluationsFile, tool: string): Aggregate {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let reviews = 0;
  for (const tools of Object.values(evaluations)) {
    const result = tools[tool];
    if (!result || result.skipped) continue;
    tp += result.tp ?? 0;
    fp += result.fp ?? 0;
    fn += result.fn ?? 0;
    reviews += 1;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, reviews, precision, recall, f1 };
}

export function toolsIn(evaluations: EvaluationsFile): string[] {
  const tools = new Set<string>();
  for (const byTool of Object.values(evaluations)) {
    for (const tool of Object.keys(byTool)) tools.add(tool);
  }
  return [...tools].sort();
}
