import { describe, expect, it } from "vitest";

import { readReviewConfig } from "./config.js";
import { annotatePatch, prepareDiff } from "./diff.js";

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
      readReviewConfig(),
    );

    expect(prepared.files).toHaveLength(0);
    expect(prepared.skippedFiles).toEqual([
      "package-lock.json (generated or vendored)",
      "src/remove.ts (no added lines)",
    ]);
  });

  it("prioritizes source files before docs and tests when patch budget is limited", () => {
    const prepared = prepareDiff(
      [
        {
          filename: "README.md",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: "@@ -1 +1,2 @@\n title\n+docs",
        },
        {
          filename: "src/example.test.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: "@@ -1 +1,2 @@\n test\n+expect(value).toBe(true);",
        },
        {
          filename: "src/example.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: "@@ -1 +1,2 @@\n export const value = true;\n+export const next = false;",
        },
      ],
      {
        ...readReviewConfig(),
        maxFiles: 1,
      },
    );

    expect(prepared.files.map((file) => file.filename)).toEqual(["src/example.ts"]);
    expect(prepared.truncated).toBe(true);
  });
});
