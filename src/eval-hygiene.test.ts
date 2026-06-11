import { describe, expect, test } from "bun:test";
import { shouldCopy } from "./eval-hygiene.ts";

// Guards the contamination class documented in EXPERIMENTS.md: agent-side
// package artifacts leaking into the clean evaluation copy.
describe("shouldCopy", () => {
  test("rejects package artifacts at any depth", () => {
    for (const name of [".env", ".npmrc", "bun.lock", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"]) {
      expect(shouldCopy(name)).toBe(false);
      expect(shouldCopy(`sub/dir/${name}`)).toBe(false);
    }
  });

  test("rejects anything under node_modules or .git", () => {
    expect(shouldCopy("node_modules/express/index.js")).toBe(false);
    expect(shouldCopy("src/node_modules/x.js")).toBe(false);
    expect(shouldCopy(".git/HEAD")).toBe(false);
  });

  test("rejects SQLite and db files", () => {
    expect(shouldCopy("data.sqlite")).toBe(false);
    expect(shouldCopy("db/data.sqlite-wal")).toBe(false);
    expect(shouldCopy("db/data.sqlite-shm")).toBe(false);
    expect(shouldCopy("app.db")).toBe(false);
  });

  test("accepts regular candidate sources", () => {
    expect(shouldCopy("src/routes/index.js")).toBe(true);
    expect(shouldCopy("package.json")).toBe(true);
    expect(shouldCopy("shape/architecture.shape")).toBe(true);
  });
});
