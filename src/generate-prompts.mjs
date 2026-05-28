import fs from "node:fs";
import path from "node:path";
import {
  conditions,
  constraintBlocks,
  levels,
  promptsDir,
  shapeGuidance,
  taskIds,
  tasksDir,
} from "./config.mjs";

const template = fs.readFileSync(path.join(promptsDir, "template.md"), "utf8");
let written = 0;

for (const taskId of taskIds) {
  const openApi = fs.readFileSync(path.join(tasksDir, taskId, "openapi.yaml"), "utf8");
  const details = fs.readFileSync(path.join(tasksDir, taskId, "details.md"), "utf8");

  for (const condition of conditions) {
    const conditionDir = path.join(promptsDir, taskId, condition);
    fs.mkdirSync(conditionDir, { recursive: true });

    for (const level of levels) {
      const guidance = condition === "shape" ? `\n\n${shapeGuidance.trim()}` : "";
      const prompt = template
        .replace("{{OPENAPI}}", `\`\`\`yaml\n${openApi.trim()}\n\`\`\``)
        .replace("{{CONSTRAINTS}}", `${constraintBlocks[level].trim()}${guidance}`)
        .replace("{{TASK_DETAILS}}", details.trim());

      fs.writeFileSync(path.join(conditionDir, `${level.toLowerCase()}.md`), prompt);
      if (taskId === "commerce-ledger" && condition === "baseline") {
        fs.writeFileSync(path.join(promptsDir, `${level.toLowerCase()}.md`), prompt);
      }
      written += 1;
    }
  }
}

console.log(`wrote ${written} prompts to ${promptsDir}`);
