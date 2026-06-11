import { describe, expect, test } from "bun:test";
import { exists, joinPath, readJson, tempDir } from "../src/bun-utils.ts";
import { injectTool, mergeCandidates, modelDir, sanitizeModelName } from "./martian.ts";
import type { BenchmarkData, CandidatesFile, ReviewComment } from "./types.ts";

const URL_A = "https://github.com/acme/widgets/pull/1";

function freshData(): BenchmarkData {
  return {
    [URL_A]: {
      source_repo: "widgets",
      golden_comments: [{ comment: "a real bug", severity: "High" }],
      reviews: [
        { tool: "other-tool", review_comments: [{ path: null, line: null, body: "pre-existing" }] },
      ],
    },
  };
}

const comment = (body: string): ReviewComment => ({ path: "src/a.ts", line: 1, body, created_at: null });

describe("injectTool", () => {
  test("adds a review for a known URL and leaves unknown URLs untouched", () => {
    const data = freshData();
    injectTool(data, "ours", new Map([[URL_A, [comment("found it")]], ["https://github.com/x/y/pull/9", []]]));
    const reviews = data[URL_A]!.reviews;
    expect(reviews.some((r) => r.tool === "ours")).toBe(true);
    expect(Object.keys(data)).toEqual([URL_A]); // unknown URL not created
  });

  test("is idempotent: re-injecting the same tool replaces, never duplicates", () => {
    const data = freshData();
    injectTool(data, "ours", new Map([[URL_A, [comment("v1")]]]));
    injectTool(data, "ours", new Map([[URL_A, [comment("v2")]]]));
    const ours = data[URL_A]!.reviews.filter((r) => r.tool === "ours");
    expect(ours).toHaveLength(1);
    expect(ours[0]!.review_comments[0]!.body).toBe("v2");
  });

  test("preserves other tools' reviews on the same entry", () => {
    const data = freshData();
    injectTool(data, "ours", new Map([[URL_A, [comment("found it")]]]));
    expect(data[URL_A]!.reviews.some((r) => r.tool === "other-tool")).toBe(true);
  });
});

describe("mergeCandidates", () => {
  test("creates the file, drops empty bodies, and preserves other tools across calls", async () => {
    const dir = await tempDir("martian-test-");
    const file = joinPath(dir, "candidates.json");

    await mergeCandidates(file, "tool-a", new Map([[URL_A, [comment("real"), comment("   "), { path: null, line: null, body: "", created_at: null }]]]));
    expect(await exists(file)).toBe(true);
    let parsed = await readJson<CandidatesFile>(file);
    expect(parsed[URL_A]!["tool-a"]).toHaveLength(1);
    expect(parsed[URL_A]!["tool-a"]![0]).toMatchObject({ text: "real", source: "shapelang" });

    await mergeCandidates(file, "tool-b", new Map([[URL_A, [comment("second tool")]]]));
    parsed = await readJson<CandidatesFile>(file);
    expect(parsed[URL_A]!["tool-a"]).toHaveLength(1); // untouched
    expect(parsed[URL_A]!["tool-b"]).toHaveLength(1);
  });
});

describe("model paths", () => {
  test("sanitizeModelName replaces slashes; modelDir nests under results/", () => {
    expect(sanitizeModelName(" openai/gpt-5.2 ")).toBe("openai_gpt-5.2");
    expect(modelDir("/x/offline", "openai/gpt-5.2")).toBe("/x/offline/results/openai_gpt-5.2");
  });
});
