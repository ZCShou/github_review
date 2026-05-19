export type ReviewReason = "pull_request" | "manual";

export type ReviewInput = {
  owner: string;
  repo: string;
  pullNumber: number;
  reason: ReviewReason;
};

export type PullFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
};

export type PullDetails = {
  title: string;
  body: string | null;
  head: {
    sha: string;
    ref: string;
  };
  base: {
    ref: string;
  };
};

export type ReviewConfig = {
  autoReviewPrEvents: boolean;
  reviewDrafts: boolean;
  skipDuplicateReviews: boolean;
  postFailureReviews: boolean;
  enableSuggestions: boolean;
  model: string;
  reasoningEffort: string;
  maxFiles: number;
  maxPatchChars: number;
  maxInlineComments: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  maxRetries: number;
  openAiApiKey?: string;
  openAiBaseUrl: string;
};

export type AnnotatedFile = PullFile & {
  annotatedPatch: string;
  commentableLines: Set<number>;
};

export type PreparedDiff = {
  files: AnnotatedFile[];
  skippedFiles: string[];
  truncated: boolean;
  totalPatchChars: number;
};

export type ModelFinding = {
  path: string;
  line: number;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  body: string;
  suggestion: string | null;
};

export type ModelReview = {
  summary: string;
  findings: ModelFinding[];
  general_comments: string[];
};

export type InlineComment = {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
};
