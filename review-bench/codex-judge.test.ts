import { describe, expect, test } from "bun:test";
import { cacheKey, extractVerdict, judgePairs, PAIR_DELIMITER, type CodexJudgeOptions } from "./codex-judge.ts";

describe("extractVerdict", () => {
  test("parses a pure-JSON message", () => {
    expect(extractVerdict('{"reasoning":"same bug","match":true,"confidence":0.9}')).toMatchObject({ match: true });
  });

  test("parses a JSON last line after prose", () => {
    const text = 'Thinking it over...\nThey describe the same issue.\n{"reasoning":"yes","match":true,"confidence":0.8}';
    expect(extractVerdict(text)).toMatchObject({ match: true });
  });

  test("parses a trailing brace group embedded in prose", () => {
    const text = 'Verdict follows: {"reasoning":"different files","match":false,"confidence":0.7} -- done';
    expect(extractVerdict(text)).toMatchObject({ match: false });
  });

  test("returns null for prose with no JSON", () => {
    expect(extractVerdict("I am unable to decide.")).toBeNull();
    expect(extractVerdict("")).toBeNull();
  });
});

describe("cacheKey", () => {
  // Regression guard for the historical cache-poisoning bug: verdicts must be
  // keyed by model so a judge migration can never replay another model's votes.
  test("differs across models for the same pair", () => {
    expect(cacheKey("gpt-5.5", "g", "c")).not.toBe(cacheKey("gpt-5.2", "g", "c"));
  });

  test("differs across pairs under one model, stable for the same pair", () => {
    expect(cacheKey("m", "g1", "c1")).not.toBe(cacheKey("m", "g2", "c2"));
    expect(cacheKey("m", "g1", "c1")).toBe(cacheKey("m", "g1", "c1"));
  });
});

describe("judgePairs cache-hit path", () => {
  test("fully cached pairs never spawn a judge process", async () => {
    const goldenYes = "a real null dereference bug";
    const goldenNo = "an off-by-one in pagination";
    const candidate = "session config null dereference";

    const cache = new Map<string, boolean>([
      [cacheKey("test-model", goldenYes, candidate), true],
      [cacheKey("test-model", goldenNo, candidate), false],
    ]);
    const opts: CodexJudgeOptions = {
      model: "test-model",
      // Bogus paths: if the cache lookup broke, runJudge would try (and fail)
      // to spawn codex — surfacing as a thrown error, failing this test.
      codexHome: "/nonexistent/codex-home",
      cwd: "/tmp",
      concurrency: 1,
      timeoutMs: 1_000,
      cache,
    };

    const matched = await judgePairs([goldenYes, goldenNo], [candidate], opts);
    expect(matched.has(`${goldenYes}${PAIR_DELIMITER}${candidate}`)).toBe(true);
    expect(matched.has(`${goldenNo}${PAIR_DELIMITER}${candidate}`)).toBe(false);
    expect(matched.size).toBe(1);
  });
});
