import type { ReviewConfig } from "./types.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export function readReviewConfig(): ReviewConfig {
  const provider = readProvider();

  return {
    provider,
    autoReviewPrEvents: readBooleanEnv("AUTO_REVIEW_PR_EVENTS", true),
    reviewDrafts: readBooleanEnv("REVIEW_DRAFTS", false),
    skipDuplicateReviews: readBooleanEnv("SKIP_DUPLICATE_REVIEWS", true),
    postFailureReviews: readBooleanEnv("POST_FAILURE_REVIEWS", false),
    enableSuggestions: readBooleanEnv("ENABLE_REVIEW_SUGGESTIONS", false),
    model: readModel(provider),
    reasoningEffort: process.env.REASONING_EFFORT ?? defaultReasoningEffort(provider),
    maxFiles: readNumberEnv("REVIEW_MAX_FILES", 30),
    maxPatchChars: readNumberEnv("REVIEW_MAX_PATCH_CHARS", 120_000),
    maxInlineComments: readNumberEnv("REVIEW_MAX_INLINE_COMMENTS", 30),
    maxOutputTokens: readNumberEnv("AI_MAX_OUTPUT_TOKENS", 8_000),
    requestTimeoutMs: readNumberEnv("AI_REQUEST_TIMEOUT_MS", provider === "deepseek" ? 300_000 : 120_000),
    maxRetries: readNumberEnv("AI_MAX_RETRIES", 2, { allowZero: true }),
    apiKey: process.env.AI_API_KEY,
    apiBaseUrl: readBaseUrl(provider),
  };
}

function readProvider(): ReviewConfig["provider"] {
  const provider = (process.env.AI_PROVIDER ?? "deepseek").toLowerCase();

  if (provider === "openai" || provider === "deepseek") {
    return provider;
  }

  return "deepseek";
}

function readModel(provider: ReviewConfig["provider"]): string {
  return process.env.AI_MODEL ?? (provider === "deepseek" ? "deepseek-v4-pro" : "gpt-5.5");
}

function readBaseUrl(provider: ReviewConfig["provider"]): string {
  const defaultBaseUrl = provider === "deepseek" ? DEFAULT_DEEPSEEK_BASE_URL : DEFAULT_OPENAI_BASE_URL;
  const baseUrl = process.env.AI_BASE_URL ?? defaultBaseUrl;

  return baseUrl.replace(/\/$/, "");
}

function defaultReasoningEffort(provider: ReviewConfig["provider"]): string {
  return provider === "deepseek" ? "high" : "medium";
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
