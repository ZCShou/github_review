import type { PreparedDiff, PullDetails, ReviewConfig, ModelFinding, ModelReview } from "./types.js";

export async function requestModelReview(
  config: ReviewConfig,
  pullRequest: PullDetails,
  preparedDiff: PreparedDiff,
): Promise<ModelReview> {
  const payload = await fetchJsonWithRetry(`${config.openAiBaseUrl}/responses`, config, {
    model: config.model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: buildSystemPrompt(config),
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildUserPrompt(pullRequest, preparedDiff),
          },
        ],
      },
    ],
    max_output_tokens: config.maxOutputTokens,
    reasoning: {
      effort: config.reasoningEffort,
    },
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "pull_request_review",
        strict: true,
        schema: reviewSchema,
      },
    },
  });

  return parseModelReview(payload);
}

async function fetchJsonWithRetry(
  url: string,
  config: ReviewConfig,
  body: Record<string, unknown>,
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${config.openAiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = await parseJsonResponse(response);

      if (response.ok) {
        return payload;
      }

      const message = extractApiError(payload, response.status);

      if (!isRetryableStatus(response.status) || attempt >= config.maxRetries) {
        throw new Error(message);
      }

      lastError = new Error(message);
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt >= config.maxRetries) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }

    await delay(retryDelayMs(attempt));
  }

  throw lastError instanceof Error ? lastError : new Error("OpenAI API request failed.");
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { message: text } };
  }
}

function buildSystemPrompt(config: ReviewConfig): string {
  const suggestionInstruction = config.enableSuggestions
    ? "Only include suggestion when it is a small, exact replacement for the commented added line."
    : "Always set suggestion to null.";

  return [
    "You are an expert pull request reviewer.",
    "Review only the diff provided by the user. Do not assume code that is not shown.",
    "Focus on correctness, security, data loss, concurrency, API misuse, regressions, missing validation, and important test gaps.",
    "Avoid style nits, broad refactors, and generic praise.",
    "Return concise Chinese review comments.",
    "For inline findings, choose exact new-file line numbers marked as `R<number> +` in the annotated diff.",
    "If a concern cannot be tied to an added line, put it in general_comments instead of inventing a line number.",
    suggestionInstruction,
    "Every finding must be actionable and explain the risk.",
  ].join("\n");
}

function buildUserPrompt(pullRequest: PullDetails, preparedDiff: PreparedDiff): string {
  const fileDiffs = preparedDiff.files
    .map((file) => {
      return [
        `### ${file.filename}`,
        `status=${file.status}; additions=${file.additions}; deletions=${file.deletions}; changes=${file.changes}`,
        "```diff",
        file.annotatedPatch,
        "```",
      ].join("\n");
    })
    .join("\n\n");

  return [
    `PR title: ${pullRequest.title}`,
    `Base branch: ${pullRequest.base.ref}`,
    `Head branch: ${pullRequest.head.ref}`,
    "",
    "PR description:",
    pullRequest.body?.trim() || "(empty)",
    "",
    "Annotated diff:",
    fileDiffs,
    "",
    `Included patch characters: ${preparedDiff.totalPatchChars}`,
    preparedDiff.truncated
      ? "Note: The diff was truncated because it exceeded the configured review budget."
      : "Note: The full configured diff budget is included.",
  ].join("\n");
}

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings", "general_comments"],
  properties: {
    summary: {
      type: "string",
      description: "Brief Chinese summary of the review result.",
    },
    findings: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "line", "severity", "title", "body", "suggestion"],
        properties: {
          path: {
            type: "string",
            description: "File path exactly as shown in the diff heading.",
          },
          line: {
            type: "integer",
            minimum: 1,
            description: "New-file line number from an R<number> + diff line.",
          },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
          },
          title: {
            type: "string",
          },
          body: {
            type: "string",
          },
          suggestion: {
            type: ["string", "null"],
          },
        },
      },
    },
    general_comments: {
      type: "array",
      maxItems: 10,
      items: {
        type: "string",
      },
    },
  },
} as const;

function parseModelReview(payload: unknown): ModelReview {
  const outputText = extractOutputText(payload);
  const parsed = JSON.parse(outputText) as unknown;

  if (!isModelReview(parsed)) {
    throw new Error("The model returned a response that does not match the expected review shape.");
  }

  return parsed;
}

function extractOutputText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new Error("The model response did not include output text.");
  }

  const chunks: string[] = [];

  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (isRecord(content) && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  const outputText = chunks.join("");

  if (!outputText) {
    throw new Error("The model response did not include text content.");
  }

  return outputText;
}

function isModelReview(value: unknown): value is ModelReview {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.summary === "string" &&
    Array.isArray(value.findings) &&
    value.findings.every(isModelFinding) &&
    Array.isArray(value.general_comments) &&
    value.general_comments.every((comment) => typeof comment === "string")
  );
}

function isModelFinding(value: unknown): value is ModelFinding {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.path === "string" &&
    Number.isInteger(value.line) &&
    ["critical", "high", "medium", "low"].includes(String(value.severity)) &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    (typeof value.suggestion === "string" || value.suggestion === null)
  );
}

function extractApiError(payload: unknown, status: number): string {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
    return `OpenAI API error ${status}: ${payload.error.message}`;
  }

  return `OpenAI API error ${status}`;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof TypeError && error.message.toLowerCase().includes("fetch"))
  );
}

function retryDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** attempt, 8_000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
