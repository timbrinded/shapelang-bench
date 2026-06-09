// TypeScript mirrors of the Martian offline benchmark JSON schemas.
// Source of truth: external/code-review-benchmark/offline/code_review_benchmark/*.py

export type GoldenComment = {
  comment: string;
  severity?: string | null;
};

export type ReviewComment = {
  path: string | null;
  line: number | null;
  body: string;
  created_at?: string | null;
};

export type Review = {
  tool: string;
  pr_url?: string | null;
  repo_name?: string | null;
  review_comments: ReviewComment[];
  candidates?: unknown[];
};

export type BenchmarkEntry = {
  pr_title?: string;
  original_url?: string;
  source_repo?: string;
  golden_source_file?: string;
  golden_comments: GoldenComment[];
  reviews: Review[];
};

// benchmark_data.json: keyed by the original PR URL ("golden_url").
export type BenchmarkData = Record<string, BenchmarkEntry>;

// results/<model>/candidates.json: url -> tool -> candidates.
export type Candidate = {
  text: string;
  path: string | null;
  line: number | null;
  source: string;
};
export type CandidatesFile = Record<string, Record<string, Candidate[]>>;

// results/<model>/dedup_groups.json: url -> tool -> list of index groups.
export type DedupGroupsFile = Record<string, Record<string, number[][]>>;

// results/<model>/evaluations.json: url -> tool -> result.
export type EvalResult = {
  skipped?: boolean;
  reason?: string;
  total_candidates?: number;
  total_golden?: number;
  tp?: number;
  fp?: number;
  fn?: number;
  errors_count?: number;
  precision?: number;
  recall?: number;
  tool?: string;
  repo_name?: string | null;
  pr_url?: string | null;
  true_positives?: unknown[];
  false_positives?: unknown[];
  false_negatives?: unknown[];
};
export type EvaluationsFile = Record<string, Record<string, EvalResult>>;

// A single PR resolved from benchmark_data.json, used by the two phases.
export type PrSpec = {
  goldenUrl: string; // original PR URL; the key in benchmark_data.json
  owner: string;
  repo: string; // owner/name, e.g. "getsentry/sentry"
  repoName: string; // name only, e.g. "sentry"
  sourceRepo: string; // golden source bucket, e.g. "sentry"
  prNumber: number;
  goldenComments: GoldenComment[];
};
