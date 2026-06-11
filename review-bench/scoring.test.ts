import { describe, expect, test } from "bun:test";
import { joinPath, readJson } from "../src/bun-utils.ts";
import { smokeFixturesDir } from "./config.ts";
import { aggregateTool, evaluateReview, stubMatch, tokenize } from "./scoring.ts";
import type { BenchmarkData, EvaluationsFile, GoldenComment } from "./types.ts";

// These tests LOCK IN the Martian-parity semantics of scoring.ts. If a test
// here starts failing, either scoring.ts regressed or upstream Martian changed
// its judge math — never weaken a test to make a scoring change pass.

const golden = (...comments: string[]): GoldenComment[] =>
  comments.map((comment) => ({ comment, severity: "High" }));

describe("tokenize", () => {
  test("lowercases, strips punctuation, drops words of 3 chars or fewer", () => {
    const tokens = tokenize("The NULL-Dereference bug; a fix");
    expect(tokens.has("null")).toBe(true);
    expect(tokens.has("dereference")).toBe(true);
    expect(tokens.has("the")).toBe(false); // 3 chars
    expect(tokens.has("bug")).toBe(false); // 3 chars
    expect(tokens.has("a")).toBe(false);
  });
});

describe("stubMatch", () => {
  test("matches when two or more significant tokens are shared", () => {
    expect(stubMatch("null dereference in session config", "session config null dereference crash")).toBe(true);
  });

  test("does not match on a single shared token", () => {
    expect(stubMatch("null dereference in loader", "rename the loader variable")).toBe(false);
  });
});

describe("evaluateReview", () => {
  test("no golden comments -> skipped result", () => {
    const result = evaluateReview([], ["anything"], stubMatch);
    expect(result.skipped).toBe(true);
    expect(result.tp).toBe(0);
    expect(result.fn).toBe(0);
    expect(result.total_candidates).toBe(1);
  });

  test("no candidates -> every golden is a false negative", () => {
    const result = evaluateReview(golden("first real bug here", "second real bug here"), [], stubMatch);
    expect(result.skipped).toBe(false);
    expect(result.tp).toBe(0);
    expect(result.fn).toBe(2);
    expect(result.recall).toBe(0);
    expect(result.false_negatives).toHaveLength(2);
  });

  test("one match among two candidates -> tp 1, fp 1, precision 0.5, recall 1", () => {
    const result = evaluateReview(
      golden("null dereference crashes session loader"),
      ["session loader null dereference crash", "rename helper variable please"],
      stubMatch,
    );
    expect(result.tp).toBe(1);
    expect(result.fp).toBe(1);
    expect(result.fn).toBe(0);
    expect(result.precision).toBe(0.5);
    expect(result.recall).toBe(1);
  });

  test("dedup sibling propagation: a matched candidate clears its group siblings", () => {
    const candidates = ["session loader null dereference crash", "completely unrelated style remark"];
    const match = (g: string, c: string) => c === candidates[0];
    const result = evaluateReview(golden("null dereference crashes session loader"), candidates, match, [[0, 1]]);
    expect(result.tp).toBe(1);
    // The unmatched sibling is in the matched candidate's dedup group, so it is
    // NOT a false positive (mirrors Martian's step3 sibling propagation).
    expect(result.fp).toBe(0);
  });

  test("duplicate candidate texts collapse in FP accounting but count in total_candidates", () => {
    // Current behavior (scoring.ts:94-95): candidateMatched is keyed by text,
    // so two identical unmatched candidates produce ONE fp entry while the
    // precision denominator stays candidates.length. Locked in deliberately.
    const result = evaluateReview(golden("null dereference crashes session loader"), ["same text here", "same text here"], () => false);
    expect(result.total_candidates).toBe(2);
    expect(result.fp).toBe(1);
    expect(result.tp).toBe(0);
  });

  test("smoke-fixture oracle parity: shape review scores tp/fp/fn = 1/1/0", async () => {
    const data = await readJson<BenchmarkData>(joinPath(smokeFixturesDir, "benchmark_data.json"));
    const entry = Object.values(data)[0]!;
    const reviews = await readJson<Array<{ body: string }>>(joinPath(smokeFixturesDir, "review-shape.json"));
    const result = evaluateReview(entry.golden_comments, reviews.map((r) => r.body), stubMatch);
    expect(result.tp).toBe(1);
    expect(result.fp).toBe(1);
    expect(result.fn).toBe(0);
  });
});

describe("aggregateTool", () => {
  test("pools tp/fp/fn across URLs, skips skipped entries and other tools", () => {
    const evaluations: EvaluationsFile = {
      "https://github.com/a/r/pull/1": {
        t: { tp: 1, fp: 1, fn: 0 },
        other: { tp: 9, fp: 9, fn: 9 },
      },
      "https://github.com/a/r/pull/2": {
        t: { tp: 1, fp: 0, fn: 1 },
      },
      "https://github.com/a/r/pull/3": {
        t: { skipped: true, tp: 5, fp: 5, fn: 5 },
      },
    };
    const agg = aggregateTool(evaluations, "t");
    expect(agg.tp).toBe(2);
    expect(agg.fp).toBe(1);
    expect(agg.fn).toBe(1);
    expect(agg.reviews).toBe(2);
    expect(agg.precision).toBeCloseTo(2 / 3, 5);
    expect(agg.recall).toBeCloseTo(2 / 3, 5);
    expect(agg.f1).toBeCloseTo(2 / 3, 5);
  });

  test("unknown tool aggregates to zeros without dividing by zero", () => {
    const agg = aggregateTool({}, "missing");
    expect(agg).toEqual({ tp: 0, fp: 0, fn: 0, reviews: 0, precision: 0, recall: 0, f1: 0 });
  });
});
