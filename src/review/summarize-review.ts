import { exists, joinPath, parseArgs, readJson } from "../bun-utils.ts";
import { realContext, type ReviewContext } from "./context.ts";
import { reviewConditions, toolName } from "./config.ts";
import { modelDir } from "./martian.ts";
import { aggregateTool } from "./scoring.ts";
import type { EvaluationsFile } from "./types.ts";

// Published Martian tools to show next to ours when present in the same file.
const PUBLISHED = ["coderabbit", "bugbot", "greptile", "qodo", "copilot", "devin", "augment"];

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export async function summarizeReview(
  ctx: ReviewContext,
  evaluationsInput?: EvaluationsFile,
): Promise<void> {
  const evaluationsFile = joinPath(modelDir(ctx.offlineDir, ctx.judgeModel), "evaluations.json");
  const evaluations =
    evaluationsInput ??
    ((await exists(evaluationsFile)) ? await readJson<EvaluationsFile>(evaluationsFile) : {});

  const rows: Array<Record<string, string | number>> = [];
  const pushRow = (label: string, tool: string) => {
    const agg = aggregateTool(evaluations, tool);
    if (agg.reviews === 0 && !tool.startsWith("shapelang-")) return;
    rows.push({
      tool: label,
      precision: pct(agg.precision),
      recall: pct(agg.recall),
      f1: pct(agg.f1),
      reviews: agg.reviews,
      tp: agg.tp,
      fp: agg.fp,
      fn: agg.fn,
    });
  };

  for (const condition of reviewConditions) pushRow(toolName(condition), toolName(condition));
  for (const tool of PUBLISHED) pushRow(`(${tool})`, tool);

  console.table(rows);

  const baseline = aggregateTool(evaluations, toolName("baseline"));
  const shape = aggregateTool(evaluations, toolName("shape"));
  console.log(
    `shape − baseline F1 delta: ${((shape.f1 - baseline.f1) * 100).toFixed(1)} pts ` +
      `(baseline ${pct(baseline.f1)} → shape ${pct(shape.f1)})`,
  );
}

if (import.meta.main) {
  const args = parseArgs();
  const ctx = realContext(args.model ? { judgeModel: args.model } : {});
  await summarizeReview(ctx);
}
