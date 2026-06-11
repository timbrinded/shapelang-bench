import { describe, expect, test } from "bun:test";
import { conditions, constraintBlocks, levels, promptsDir, taskIds, tasksDir } from "./config.ts";
import { joinPath, readText } from "./bun-utils.ts";
import { renderPrompt } from "./prompt-render.ts";

// Determinism gate: the committed prompts/ files are BENCHMARK INPUTS. If this
// test fails, the generator (template/config) and the committed prompts have
// drifted apart — investigate which side changed; do NOT regenerate prompts to
// silence it (that silently changes the benchmark).
describe("prompt generation determinism", () => {
  test("every committed task prompt matches a fresh render", async () => {
    const template = await readText(joinPath(promptsDir, "template.md"));
    for (const taskId of taskIds) {
      const openApi = await readText(joinPath(tasksDir, taskId, "openapi.yaml"));
      const details = await readText(joinPath(tasksDir, taskId, "details.md"));
      for (const condition of conditions) {
        for (const level of levels as (keyof typeof constraintBlocks)[]) {
          const rendered = renderPrompt(template, openApi, details, level, condition);
          const committed = await readText(
            joinPath(promptsDir, taskId, condition, `${level.toLowerCase()}.md`),
          );
          expect(rendered, `${taskId}/${condition}/${level}`).toBe(committed);
        }
      }
    }
  });

  test("root-level convenience prompts match the commerce-ledger baseline renders", async () => {
    const template = await readText(joinPath(promptsDir, "template.md"));
    const openApi = await readText(joinPath(tasksDir, "commerce-ledger", "openapi.yaml"));
    const details = await readText(joinPath(tasksDir, "commerce-ledger", "details.md"));
    for (const level of levels as (keyof typeof constraintBlocks)[]) {
      const rendered = renderPrompt(template, openApi, details, level, "baseline");
      const committed = await readText(joinPath(promptsDir, `${level.toLowerCase()}.md`));
      expect(rendered, `root ${level}`).toBe(committed);
    }
  });
});
