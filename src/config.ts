import type { ReviewConfig } from "./types.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export function readReviewConfig(): ReviewConfig {
  return {
    autoReviewPrEvents: readBooleanEnv("AUTO_REVIEW_PR_EVENTS", true),
    reviewDrafts: readBooleanEnv("REVIEW_DRAFTS", false),
    skipDuplicateReviews: readBooleanEnv("SKIP_DUPLICATE_REVIEWS", true),
    postFailureReviews: readBooleanEnv("POST_FAILURE_REVIEWS", false),
    enableSuggestions: readBooleanEnv("ENABLE_REVIEW_SUGGESTIONS", false),
    model: process.env.OPENAI_MODEL ?? "gpt-5.5",
    reasoningEffort: process.env.OPENAI_REASONING_EFFORT ?? "medium",
    maxFiles: readNumberEnv("REVIEW_MAX_FILES", 30),
    maxPatchChars: readNumberEnv("REVIEW_MAX_PATCH_CHARS", 120_000),
    maxInlineComments: readNumberEnv("REVIEW_MAX_INLINE_COMMENTS", 30),
    maxOutputTokens: readNumberEnv("OPENAI_MAX_OUTPUT_TOKENS", 8_000),
    requestTimeoutMs: readNumberEnv("OPENAI_REQUEST_TIMEOUT_MS", 120_000),
    maxRetries: readNumberEnv("OPENAI_MAX_RETRIES", 2, { allowZero: true }),
    openAiApiKey: process.env.OPENAI_API_KEY,
    openAiBaseUrl: (process.env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL).replace(/\/$/, ""),
  };
}

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];

  if (value === undefined) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readNumberEnv(
  name: string,
  defaultValue: number,
  options: { allowZero?: boolean } = {},
): number {
  const value = process.env[name];

  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  const minimum = options.allowZero ? 0 : 1;
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : defaultValue;
}
