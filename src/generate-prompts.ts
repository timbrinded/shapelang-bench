import {
  conditions,
  levels,
  promptsDir,
  taskIds,
  tasksDir,
} from "./config.ts";
import { joinPath, makeDir, readText, writeText } from "./bun-utils.ts";
import {
  defaultLanguage,
  languageIds,
  languageProfiles,
  shapeGuidanceForLanguage,
} from "./languages.ts";

const template = await readText(joinPath(promptsDir, "template.md"));
let written = 0;

for (const language of languageIds) {
  const profile = languageProfiles[language];

  for (const taskId of taskIds) {
    const openApi = await readText(joinPath(tasksDir, taskId, "openapi.yaml"));
    const details = await readText(joinPath(tasksDir, taskId, "details.md"));

    for (const condition of conditions) {
      const conditionDir = joinPath(promptsDir, language, taskId, condition);
      await makeDir(conditionDir);

      for (const level of levels) {
        const guidance = condition === "shape" ? `\n\n${shapeGuidanceForLanguage(language).trim()}` : "";
        const prompt = template
          .replace("{{OPENAPI}}", `\`\`\`yaml\n${openApi.trim()}\n\`\`\``)
          .replace("{{CANDIDATE_KIND}}", profile.candidateKind)
          .replace("{{LANGUAGE_REQUIREMENTS}}", profile.requirements)
          .replace("{{CONSTRAINTS}}", `${profile.constraintBlocks[level].trim()}${guidance}`)
          .replace("{{TASK_DETAILS}}", details.trim())
          .replace("{{EVALUATION_STEPS}}", profile.evaluation);

        await writeText(joinPath(conditionDir, `${level.toLowerCase()}.md`), prompt);
        if (language === defaultLanguage) {
          const legacyConditionDir = joinPath(promptsDir, taskId, condition);
          await makeDir(legacyConditionDir);
          await writeText(joinPath(legacyConditionDir, `${level.toLowerCase()}.md`), prompt);
          if (taskId === "commerce-ledger" && condition === "baseline") {
            await writeText(joinPath(promptsDir, `${level.toLowerCase()}.md`), prompt);
          }
        }
        written += 1;
      }
    }
  }
}

console.log(`wrote ${written} prompts to ${promptsDir}`);
