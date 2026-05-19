import { describe, expect, it } from "vitest";

import { readReviewConfig } from "./config.js";
import { prepareDiff } from "./diff.js";
import { buildInlineComments } from "./review.js";

describe("inline comments", () => {
  it("keeps only model findings that point at added diff lines", () => {
    const prepared = prepareDiff(
      [
        {
          filename: "src/example.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: "@@ -4,1 +4,2 @@\n const old = true;\n+dangerousCall();",
        },
      ],
      readReviewConfig(),
    );

    const result = buildInlineComments(
      {
        summary: "发现一个问题。",
        general_comments: [],
        findings: [
          {
            path: "src/example.ts",
            line: 5,
            severity: "high",
            title: "缺少错误处理",
            body: "新增调用失败时会直接抛出，可能中断请求。",
            suggestion: null,
          },
          {
            path: "src/example.ts",
            line: 4,
            severity: "medium",
            title: "错误行号",
            body: "这一行不是新增行，不能作为 inline 评论。",
            suggestion: null,
          },
        ],
      },
      prepared,
      readReviewConfig(),
    );

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toMatchObject({
      path: "src/example.ts",
      line: 5,
      side: "RIGHT",
    });
    expect(result.downgradedFindings).toHaveLength(1);
  });

  it("suppresses suggestion blocks unless explicitly enabled", () => {
    const prepared = prepareDiff(
      [
        {
          filename: "src/example.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: "@@ -1 +1,2 @@\n export const value = true;\n+dangerousCall();",
        },
      ],
      readReviewConfig(),
    );

    const result = buildInlineComments(
      {
        summary: "发现一个问题。",
        general_comments: [],
        findings: [
          {
            path: "src/example.ts",
            line: 2,
            severity: "medium",
            title: "建议关闭",
            body: "默认不发布 suggestion block。",
            suggestion: "safeCall();",
          },
        ],
      },
      prepared,
      {
        ...readReviewConfig(),
        enableSuggestions: false,
      },
    );

    expect(result.comments[0]?.body).not.toContain("```suggestion");
  });
});
