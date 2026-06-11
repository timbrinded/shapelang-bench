import { constraintBlocks, shapeGuidance } from "./config.ts";

// Pure prompt renderer, extracted from generate-prompts.ts so determinism can
// be tested: the committed prompts/ files are benchmark inputs, and any drift
// between this function and them must fail a test, not slip in silently.
export function renderPrompt(
  template: string,
  openApi: string,
  details: string,
  level: keyof typeof constraintBlocks,
  condition: string,
): string {
  const guidance = condition === "shape" ? `\n\n${shapeGuidance.trim()}` : "";
  return template
    .replace("{{OPENAPI}}", `\`\`\`yaml\n${openApi.trim()}\n\`\`\``)
    .replace("{{CONSTRAINTS}}", `${constraintBlocks[level].trim()}${guidance}`)
    .replace("{{TASK_DETAILS}}", details.trim());
}
