// Shapes returned by the BFF's /api/evals/* routes. The run payload is exactly
// the shape the harness produces (report.assemble in the Python eval package), so
// the standalone dashboard and this SPA tab share one contract.

export interface Scorecard {
  model: string;
  n_cases: number;
  avg_quality: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  avg_cost_usd: number;
  total_cost_usd: number;
  success_rate: number;
  n_errors: number;
}

export interface TagRow {
  model: string;
  quality: number;
  success: number;
  n: number;
}

export interface TagBreakdown {
  tag: string;
  rows: TagRow[];
}

export interface CaseRecord {
  case_id: string;
  model: string;
  tags: string[];
  prompt: string;
  response: string;
  quality: number;
  rationale: string;
  latency_ms: number;
  cost_usd: number;
  success: boolean;
  error: string;
  input_tokens: number;
  output_tokens: number;
}

export interface RunMeta {
  suite: string;
  judge: string;
  models: string[];
  generated_at: string;
  n_cases: number;
  git_sha?: string;
  run_id?: string;
  tenant_id?: string;
}

export interface RunPayload {
  meta: RunMeta;
  scorecards: Scorecard[];
  tags: TagBreakdown[];
  cases: CaseRecord[];
}

// The lightweight row the run list shows (from the DynamoDB run header).
export interface RunSummary {
  runId: string;
  suite: string;
  judge: string;
  createdAt: string;
  status: string;
  topModel?: string;
  topQuality?: number;
  nModels?: number;
}
