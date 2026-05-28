import {
  conditions,
  constraintBlocks,
  levels,
  promptsDir,
  shapeGuidance,
  taskIds,
  tasksDir,
} from "./config.ts";
import { joinPath, readText, writeText } from "./bun-utils.ts";

const template = await readText(joinPath(promptsDir, "template.md"));
let written = 0;

for (const taskId of taskIds) {
  const openApi = await readText(joinPath(tasksDir, taskId, "openapi.yaml"));
  const details = await readText(joinPath(tasksDir, taskId, "details.md"));

  for (const condition of conditions) {
    const conditionDir = joinPath(promptsDir, taskId, condition);

    for (const level of levels) {
      const guidance = condition === "shape" ? `\n\n${shapeGuidance.trim()}` : "";
      const prompt = template
        .replace("{{OPENAPI}}", `\`\`\`yaml\n${openApi.trim()}\n\`\`\``)
        .replace("{{CONSTRAINTS}}", `${constraintBlocks[level].trim()}${guidance}`)
        .replace("{{TASK_DETAILS}}", details.trim());

      await writeText(joinPath(conditionDir, `${level.toLowerCase()}.md`), prompt);
      if (taskId === "commerce-ledger" && condition === "baseline") {
        await writeText(joinPath(promptsDir, `${level.toLowerCase()}.md`), prompt);
      }
      written += 1;
    }
  }
}

console.log(`wrote ${written} prompts to ${promptsDir}`);
