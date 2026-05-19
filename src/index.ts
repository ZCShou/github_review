import type { Context, Probot } from "probot";

type ReviewInput = {
  owner: string;
  repo: string;
  pullNumber: number;
  reason: "pull_request" | "manual";
};

type PullFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
};

type PullDetails = {
  title: string;
  body: string | null;
  head: {
    sha: string;
    ref: string;
  };
  base: {
    ref: string;
  };
  draft?: boolean;
};

type ReviewConfig = {
  autoReviewPrEvents: boolean;
  reviewDrafts: boolean;
  model: string;
  reasoningEffort: string;
  maxFiles: number;
  maxPatchChars: number;
  maxInlineComments: number;
  maxOutputTokens: number;
  openAiApiKey?: string;
  openAiBaseUrl: string;
};

type AnnotatedFile = PullFile & {
  annotatedPatch: string;
  commentableLines: Set<number>;
};

type PreparedDiff = {
  files: AnnotatedFile[];
  skippedFiles: string[];
  truncated: boolean;
  totalPatchChars: number;
};

type ModelFinding = {
  path: string;
  line: number;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  body: string;
  suggestion: string | null;
};

type ModelReview = {
  summary: string;
  findings: ModelFinding[];
  general_comments: string[];
};

type InlineComment = {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
};

const REVIEW_COMMAND = "/review";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export default (app: Probot) => {
  app.on(
    ["pull_request.opened", "pull_request.reopened", "pull_request.synchronize"],
    async (context) => {
      const config = readReviewConfig();

      if (!config.autoReviewPrEvents) {
        context.log.info("Skipping automatic review because AUTO_REVIEW_PR_EVENTS is disabled.");
        return;
      }

      const pullRequest = context.payload.pull_request;

      if (pullRequest.draft && !config.reviewDrafts) {
        context.log.info("Skipping automatic review for draft pull request.");
        return;
      }

      await createCodeReview(context, {
        ...context.repo(),
        pullNumber: pullRequest.number,
        reason: "pull_request",
      });
    },
  );

  app.on("issue_comment.created", async (context) => {
    const issue = context.payload.issue;
    const body = context.payload.comment.body.trim();

    if (!issue.pull_request || body !== REVIEW_COMMAND) {
      return;
    }

    await createCodeReview(context, {
      ...context.repo(),
      pullNumber: issue.number,
      reason: "manual",
    });
  });
};

async function createCodeReview(context: Context, input: ReviewInput): Promise<void> {
  const config = readReviewConfig();
  const pullRequest = await getPullRequest(context, input);
  const files = await getPullFiles(context, input);
  const preparedDiff = prepareDiff(files, config);

  if (!config.openAiApiKey) {
    await submitReview(context, input, pullRequest, {
      body: buildMissingApiKeyBody(files, input.reason),
      comments: [],
    });
    return;
  }

  if (preparedDiff.files.length === 0) {
    await submitReview(context, input, pullRequest, {
      body: buildNoReviewableFilesBody(files, preparedDiff, input.reason),
      comments: [],
    });
    return;
  }

  try {
    const modelReview = await requestModelReview(config, pullRequest, preparedDiff);
    const { comments, downgradedFindings } = buildInlineComments(modelReview, preparedDiff, config);

    await submitReview(context, input, pullRequest, {
      body: buildReviewBody({
        files,
        preparedDiff,
        modelReview,
        inlineCount: comments.length,
        downgradedFindings,
        reason: input.reason,
      }),
      comments,
    });
  } catch (error) {
    context.log.error({ err: error }, "Failed to create AI pull request review.");

    await submitReview(context, input, pullRequest, {
      body: buildFailureBody(error, files, input.reason),
      comments: [],
    });
  }
}

async function getPullRequest(context: Context, input: ReviewInput): Promise<PullDetails> {
  const response = await context.octokit.rest.pulls.get({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
  });

  const pull = response.data;

  return {
    title: pull.title,
    body: pull.body,
    draft: pull.draft,
    head: {
      sha: pull.head.sha,
      ref: pull.head.ref,
    },
    base: {
      ref: pull.base.ref,
    },
  };
}

async function getPullFiles(context: Context, input: ReviewInput): Promise<PullFile[]> {
  return context.octokit.paginate(context.octokit.rest.pulls.listFiles, {
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
    per_page: 100,
  });
}

async function submitReview(
  context: Context,
  input: ReviewInput,
  pullRequest: PullDetails,
  review: { body: string; comments: InlineComment[] },
): Promise<void> {
  await context.octokit.rest.pulls.createReview({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
    commit_id: pullRequest.head.sha,
    event: "COMMENT",
    body: review.body,
    comments: review.comments,
  });
}

export function readReviewConfig(): ReviewConfig {
  return {
    autoReviewPrEvents: readBooleanEnv("AUTO_REVIEW_PR_EVENTS", true),
    reviewDrafts: readBooleanEnv("REVIEW_DRAFTS", false),
    model: process.env.OPENAI_MODEL ?? "gpt-5.5",
    reasoningEffort: process.env.OPENAI_REASONING_EFFORT ?? "medium",
    maxFiles: readNumberEnv("REVIEW_MAX_FILES", 30),
    maxPatchChars: readNumberEnv("REVIEW_MAX_PATCH_CHARS", 120_000),
    maxInlineComments: readNumberEnv("REVIEW_MAX_INLINE_COMMENTS", 30),
    maxOutputTokens: readNumberEnv("OPENAI_MAX_OUTPUT_TOKENS", 8_000),
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

function readNumberEnv(name: string, defaultValue: number): number {
  const value = process.env[name];

  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export function prepareDiff(files: PullFile[], config: ReviewConfig): PreparedDiff {
  const reviewableFiles: AnnotatedFile[] = [];
  const skippedFiles: string[] = [];
  let totalPatchChars = 0;
  let truncated = false;

  for (const file of files) {
    if (reviewableFiles.length >= config.maxFiles) {
      skippedFiles.push(`${file.filename} (file limit)`);
      truncated = true;
      continue;
    }

    if (!file.patch || isLikelyGeneratedFile(file.filename)) {
      skippedFiles.push(`${file.filename} (${file.patch ? "generated or vendored" : "no text patch"})`);
      continue;
    }

    const annotated = annotatePatch(file);

    if (annotated.commentableLines.size === 0) {
      skippedFiles.push(`${file.filename} (no added lines)`);
      continue;
    }

    if (totalPatchChars + annotated.annotatedPatch.length > config.maxPatchChars) {
      skippedFiles.push(`${file.filename} (patch budget)`);
      truncated = true;
      continue;
    }

    reviewableFiles.push(annotated);
    totalPatchChars += annotated.annotatedPatch.length;
  }

  return {
    files: reviewableFiles,
    skippedFiles,
    truncated,
    totalPatchChars,
  };
}

export function annotatePatch(file: PullFile): AnnotatedFile {
  const lines = file.patch?.split("\n") ?? [];
  const annotatedLines: string[] = [];
  const commentableLines = new Set<number>();
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);

    if (hunk) {
      oldLine = Number.parseInt(hunk[1], 10);
      newLine = Number.parseInt(hunk[2], 10);
      annotatedLines.push(line);
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      annotatedLines.push(`R${newLine} + ${line.slice(1)}`);
      commentableLines.add(newLine);
      newLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      annotatedLines.push(`L${oldLine} - ${line.slice(1)}`);
      oldLine += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      annotatedLines.push(`R${newLine}   ${line.slice(1)}`);
      oldLine += 1;
      newLine += 1;
      continue;
    }

    annotatedLines.push(line);
  }

  return {
    ...file,
    annotatedPatch: annotatedLines.join("\n"),
    commentableLines,
  };
}

function isLikelyGeneratedFile(filename: string): boolean {
  const normalized = filename.toLowerCase();
  const generatedNames = new Set([
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "composer.lock",
    "gemfile.lock",
    "poetry.lock",
    "cargo.lock",
  ]);

  if (generatedNames.has(normalized.split("/").pop() ?? normalized)) {
    return true;
  }

  return [
    "/dist/",
    "/build/",
    "/coverage/",
    "/vendor/",
    "/generated/",
    ".min.js",
    ".min.css",
    ".snap",
  ].some((pattern) => normalized.includes(pattern) || normalized.endsWith(pattern));
}

async function requestModelReview(
  config: ReviewConfig,
  pullRequest: PullDetails,
  preparedDiff: PreparedDiff,
): Promise<ModelReview> {
  const response = await fetch(`${config.openAiBaseUrl}/responses`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.openAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: buildSystemPrompt(),
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
    }),
  });

  const payload = await response.json() as unknown;

  if (!response.ok) {
    throw new Error(extractApiError(payload, response.status));
  }

  return parseModelReview(payload);
}

function buildSystemPrompt(): string {
  return [
    "You are an expert pull request reviewer.",
    "Review only the diff provided by the user. Do not assume code that is not shown.",
    "Focus on correctness, security, data loss, concurrency, API misuse, regressions, missing validation, and important test gaps.",
    "Avoid style nits, broad refactors, and generic praise.",
    "Return concise Chinese review comments.",
    "For inline findings, choose exact new-file line numbers marked as `R<number> +` in the annotated diff.",
    "If a concern cannot be tied to an added line, put it in general_comments instead of inventing a line number.",
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
            description: "Optional replacement snippet when a GitHub suggestion block is appropriate.",
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
      if (!isRecord(content)) {
        continue;
      }

      if (typeof content.text === "string") {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function buildInlineComments(
  modelReview: ModelReview,
  preparedDiff: PreparedDiff,
  config: ReviewConfig,
): { comments: InlineComment[]; downgradedFindings: ModelFinding[] } {
  const filesByName = new Map(preparedDiff.files.map((file) => [file.filename, file]));
  const comments: InlineComment[] = [];
  const downgradedFindings: ModelFinding[] = [];

  for (const finding of modelReview.findings) {
    const file = filesByName.get(finding.path);

    if (!file?.commentableLines.has(finding.line)) {
      downgradedFindings.push(finding);
      continue;
    }

    if (comments.length >= config.maxInlineComments) {
      downgradedFindings.push(finding);
      continue;
    }

    comments.push({
      path: finding.path,
      line: finding.line,
      side: "RIGHT",
      body: formatInlineComment(finding),
    });
  }

  return { comments, downgradedFindings };
}

function formatInlineComment(finding: ModelFinding): string {
  const body = [
    `**${severityLabel(finding.severity)}: ${finding.title}**`,
    "",
    finding.body,
  ];

  if (finding.suggestion?.trim()) {
    body.push("", "```suggestion", finding.suggestion.trim(), "```");
  }

  return body.join("\n");
}

function severityLabel(severity: ModelFinding["severity"]): string {
  switch (severity) {
    case "critical":
      return "Critical";
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
  }
}

function buildReviewBody(input: {
  files: PullFile[];
  preparedDiff: PreparedDiff;
  modelReview: ModelReview;
  inlineCount: number;
  downgradedFindings: ModelFinding[];
  reason: ReviewInput["reason"];
}): string {
  const totals = summarizeFiles(input.files);
  const trigger = input.reason === "manual" ? "收到 `/review` 后" : "PR 更新后";
  const generalComments = input.modelReview.general_comments
    .map((comment) => `- ${comment}`)
    .join("\n");
  const downgradedComments = input.downgradedFindings
    .map((finding) => `- \`${finding.path}:${finding.line}\` ${finding.title}: ${finding.body}`)
    .join("\n");

  return [
    `${trigger}已完成自动审查。`,
    "",
    input.modelReview.summary,
    "",
    `变更规模：${totals.changedFiles} 个文件，+${totals.totalAdditions}/-${totals.totalDeletions}。`,
    `本次审查：${input.preparedDiff.files.length} 个文本文件，${input.inlineCount} 条 inline 评论。`,
    input.preparedDiff.truncated ? "注意：diff 超出预算，本次只审查了前一部分可审查内容。" : "",
    input.preparedDiff.skippedFiles.length > 0
      ? `跳过文件：${input.preparedDiff.skippedFiles.slice(0, 12).join(", ")}${
          input.preparedDiff.skippedFiles.length > 12 ? " ..." : ""
        }`
      : "",
    generalComments ? "\n补充意见：\n" + generalComments : "",
    downgradedComments ? "\n未能定位为 inline 的意见：\n" + downgradedComments : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildMissingApiKeyBody(files: PullFile[], reason: ReviewInput["reason"]): string {
  const totals = summarizeFiles(files);
  const trigger = reason === "manual" ? "收到 `/review`，但" : "PR 更新后，";

  return [
    `${trigger}自动审查未执行：未配置 \`OPENAI_API_KEY\`。`,
    "",
    `变更规模：${totals.changedFiles} 个文件，+${totals.totalAdditions}/-${totals.totalDeletions}。`,
    "",
    "配置 `OPENAI_API_KEY` 后，机器人会调用模型分析 diff，并在可定位的新增行上提交 inline review comments。",
  ].join("\n");
}

function buildNoReviewableFilesBody(
  files: PullFile[],
  preparedDiff: PreparedDiff,
  reason: ReviewInput["reason"],
): string {
  const totals = summarizeFiles(files);
  const trigger = reason === "manual" ? "收到 `/review` 后" : "PR 更新后";

  return [
    `${trigger}未发现可审查的文本新增行。`,
    "",
    `变更规模：${totals.changedFiles} 个文件，+${totals.totalAdditions}/-${totals.totalDeletions}。`,
    preparedDiff.skippedFiles.length > 0 ? `跳过文件：${preparedDiff.skippedFiles.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFailureBody(error: unknown, files: PullFile[], reason: ReviewInput["reason"]): string {
  const totals = summarizeFiles(files);
  const trigger = reason === "manual" ? "收到 `/review`，但" : "PR 更新后，";
  const message = error instanceof Error ? error.message : "unknown error";

  return [
    `${trigger}自动审查失败。`,
    "",
    `错误：${message}`,
    "",
    `变更规模：${totals.changedFiles} 个文件，+${totals.totalAdditions}/-${totals.totalDeletions}。`,
  ].join("\n");
}

function summarizeFiles(files: PullFile[]): {
  changedFiles: number;
  totalAdditions: number;
  totalDeletions: number;
} {
  return {
    changedFiles: files.length,
    totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

function extractApiError(payload: unknown, status: number): string {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
    return `OpenAI API error ${status}: ${payload.error.message}`;
  }

  return `OpenAI API error ${status}`;
}
