import { describe, expect, it } from "vitest";

import {
  annotatePatch,
  buildInlineComments,
  prepareDiff,
  readReviewConfig,
} from "./index.js";

describe("diff preparation", () => {
  it("annotates new-file line numbers that can receive inline comments", () => {
    const file = annotatePatch({
      filename: "src/example.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      changes: 3,
      patch: [
        "@@ -10,3 +10,4 @@ export function demo() {",
        " const existing = true;",
        "-return oldValue;",
        "+const next = compute();",
        "+return next;",
      ].join("\n"),
    });

    expect(file.commentableLines.has(11)).toBe(true);
    expect(file.commentableLines.has(12)).toBe(true);
    expect(file.annotatedPatch).toContain("R11 + const next = compute();");
    expect(file.annotatedPatch).toContain("R12 + return next;");
  });

  it("skips lockfiles and files without added lines", () => {
    const config = readReviewConfig();
    const prepared = prepareDiff(
      [
        {
          filename: "package-lock.json",
          status: "modified",
          additions: 1,
          deletions: 1,
          changes: 2,
          patch: "@@ -1 +1 @@\n-old\n+new",
        },
        {
          filename: "src/remove.ts",
          status: "modified",
          additions: 0,
          deletions: 1,
          changes: 1,
          patch: "@@ -1 +0,0 @@\n-old",
        },
      ],
      config,
    );

    expect(prepared.files).toHaveLength(0);
    expect(prepared.skippedFiles).toEqual([
      "package-lock.json (generated or vendored)",
      "src/remove.ts (no added lines)",
    ]);
  });
});

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
});
