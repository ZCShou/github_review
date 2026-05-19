import type { ModelFinding, ModelReview, PreparedDiff, PullFile, ReviewConfig, ReviewReason } from "./types.js";

export function buildReviewBody(input: {
  files: PullFile[];
  preparedDiff: PreparedDiff;
  modelReview: ModelReview;
  inlineCount: number;
  downgradedFindings: ModelFinding[];
  reason: ReviewReason;
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
    `本次审查：${input.preparedDiff.files.length} 个文本文件，${input.inlineCount} 条 inline 评论，送审 patch ${input.preparedDiff.totalPatchChars} 字符。`,
    input.preparedDiff.truncated ? "注意：diff 超出预算，本次只审查了优先级最高的一部分可审查内容。" : "",
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

export function buildMissingApiKeyBody(files: PullFile[], reason: ReviewReason): string {
  const totals = summarizeFiles(files);
  const trigger = reason === "manual" ? "收到 `/review`，但" : "PR 更新后，";

  return [
    `${trigger}自动审查未执行：未配置 \`AI_API_KEY\`。`,
    "",
    `变更规模：${totals.changedFiles} 个文件，+${totals.totalAdditions}/-${totals.totalDeletions}。`,
    "",
    "配置 `AI_API_KEY` 后，机器人会调用模型分析 diff，并在可定位的新增行上提交 inline review comments。",
  ].join("\n");
}

export function buildNoReviewableFilesBody(
  files: PullFile[],
  preparedDiff: PreparedDiff,
  reason: ReviewReason,
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

export function buildFailureBody(error: unknown, files: PullFile[], reason: ReviewReason): string {
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

export function formatInlineComment(finding: ModelFinding, config: ReviewConfig): string {
  const body = [
    `**${severityLabel(finding.severity)}: ${finding.title}**`,
    "",
    finding.body,
  ];

  if (config.enableSuggestions && isSafeSuggestion(finding.suggestion)) {
    body.push("", "```suggestion", finding.suggestion.trim(), "```");
  }

  return body.join("\n");
}

function isSafeSuggestion(suggestion: string | null): suggestion is string {
  if (!suggestion?.trim()) {
    return false;
  }

  return suggestion.length <= 4_000 && !suggestion.includes("```") && suggestion.split("\n").length <= 20;
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
