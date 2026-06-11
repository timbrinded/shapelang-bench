import { conditions, constraintBlocks, levels, promptsDir, taskIds, tasksDir } from "./config.ts";
import { joinPath, readText, writeText } from "./bun-utils.ts";
import { renderPrompt } from "./prompt-render.ts";

const template = await readText(joinPath(promptsDir, "template.md"));
let written = 0;

for (const taskId of taskIds) {
  const openApi = await readText(joinPath(tasksDir, taskId, "openapi.yaml"));
  const details = await readText(joinPath(tasksDir, taskId, "details.md"));

  for (const condition of conditions) {
    const conditionDir = joinPath(promptsDir, taskId, condition);

    for (const level of levels) {
      const prompt = renderPrompt(
        template,
        openApi,
        details,
        level as keyof typeof constraintBlocks,
        condition,
      );

      await writeText(joinPath(conditionDir, `${level.toLowerCase()}.md`), prompt);
      if (taskId === "commerce-ledger" && condition === "baseline") {
        await writeText(joinPath(promptsDir, `${level.toLowerCase()}.md`), prompt);
      }
      written += 1;
    }
  }
}

console.log(`wrote ${written} prompts to ${promptsDir}`);
