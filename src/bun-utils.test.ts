import { describe, expect, test } from "bun:test";
import { joinPath, normalizePath, parseArgs } from "./bun-utils.ts";

describe("parseArgs", () => {
  test("parses flag/value pairs", () => {
    expect(parseArgs(["--task", "x", "--trials", "3"])).toEqual({ task: "x", trials: "3" });
  });

  test("a flag followed by another flag is boolean true and never eats it", () => {
    // Regression: `--copy-auth --trials 3` used to record copy-auth="--trials"
    // AND drop trials — two silent wrong behaviors from one invocation.
    expect(parseArgs(["--copy-auth", "--trials", "3"])).toEqual({ "copy-auth": "true", trials: "3" });
  });

  test("a trailing bare flag is boolean true", () => {
    expect(parseArgs(["--reindex"])).toEqual({ reindex: "true" });
  });

  test("positional tokens are skipped", () => {
    expect(parseArgs(["positional", "--a", "1"])).toEqual({ a: "1" });
  });
});

describe("path helpers", () => {
  test("joinPath resolves dot segments", () => {
    expect(joinPath("a", "..", "b")).toBe("b");
    expect(joinPath("/x", "y", "z.txt")).toBe("/x/y/z.txt");
  });

  test("normalizePath collapses . and ..", () => {
    expect(normalizePath("/x/./y/../z")).toBe("/x/z");
    expect(normalizePath("")).toBe(".");
  });
});
