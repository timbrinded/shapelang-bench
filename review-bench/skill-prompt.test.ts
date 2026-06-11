import { describe, expect, test } from "bun:test";
import { parseReviewComments } from "./skill-prompt.ts";

// Contract: [] = a genuine "no defects" review; null = not a review at all
// (crash/truncation/prose). Collapsing the two recorded agent failures as real
// 0-F1 scores — the silent-corruption bug plan 002 closes.
describe("parseReviewComments", () => {
  test("parses the canonical {comments: [...]} form", () => {
    const out = parseReviewComments('{"comments":[{"path":"a.ts","line":3,"body":"bug"}]}');
    expect(out).toEqual([{ path: "a.ts", line: 3, body: "bug", created_at: null }]);
  });

  test("parses a bare array; missing path/line become null", () => {
    const out = parseReviewComments('[{"body":"x"}]');
    expect(out).toEqual([{ path: null, line: null, body: "x", created_at: null }]);
  });

  test('{"comments": []} is an empty review, not a failure', () => {
    expect(parseReviewComments('{"comments": []}')).toEqual([]);
  });

  test("parsed object without a comments array is an empty review", () => {
    expect(parseReviewComments('{"unrelated": true}')).toEqual([]);
  });

  test("truncated JSON is a failure (null), never an empty review", () => {
    expect(parseReviewComments('{"comments": [{"body": "bu')).toBeNull();
  });

  test("prose is a failure (null)", () => {
    expect(parseReviewComments("I could not find review.json")).toBeNull();
  });

  test("comments with empty or non-string bodies are dropped", () => {
    const out = parseReviewComments(
      '{"comments":[{"body":"  "},{"body":42},{"body":"real"},"not-an-object"]}',
    );
    expect(out).toEqual([{ path: null, line: null, body: "real", created_at: null }]);
  });
});
