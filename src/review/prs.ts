import type { BenchmarkData, PrSpec } from "./types.ts";

// Parse a GitHub PR URL like https://github.com/getsentry/sentry/pull/93824
export function parsePrUrl(url: string): { owner: string; name: string; prNumber: number } | null {
  const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (!match) return null;
  return { owner: match[1]!, name: match[2]!, prNumber: Number(match[3]!) };
}

// Build the PR work list directly from benchmark_data.json (the 50 PRs, golden
// comments embedded). `subset` optionally filters by source repo or PR number.
export function listPrs(data: BenchmarkData, subset?: string[]): PrSpec[] {
  const specs: PrSpec[] = [];
  for (const [goldenUrl, entry] of Object.entries(data)) {
    const parsed = parsePrUrl(goldenUrl);
    if (!parsed) continue;
    const sourceRepo =
      entry.source_repo ?? entry.golden_source_file?.replace(/\.json$/, "") ?? parsed.name;
    specs.push({
      goldenUrl,
      owner: parsed.owner,
      repo: `${parsed.owner}/${parsed.name}`,
      repoName: parsed.name,
      sourceRepo,
      prNumber: parsed.prNumber,
      goldenComments: entry.golden_comments ?? [],
    });
  }
  if (subset && subset.length > 0) {
    const wanted = new Set(subset.map((value) => value.trim()).filter(Boolean));
    return specs.filter(
      (spec) =>
        wanted.has(spec.sourceRepo) ||
        wanted.has(spec.repoName) ||
        wanted.has(String(spec.prNumber)) ||
        wanted.has(spec.goldenUrl),
    );
  }
  return specs;
}

// Cache key for a project index: a repo at a specific base commit.
export function indexKey(repoName: string, baseSha: string): string {
  return `${repoName}@${baseSha}`;
}
