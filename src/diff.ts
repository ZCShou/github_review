import type { AnnotatedFile, PreparedDiff, PullFile, ReviewConfig } from "./types.js";

const GENERATED_FILENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "composer.lock",
  "gemfile.lock",
  "poetry.lock",
  "cargo.lock",
]);

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scala",
  ".sql",
  ".swift",
  ".ts",
  ".tsx",
]);

export function prepareDiff(files: PullFile[], config: ReviewConfig): PreparedDiff {
  const candidates: AnnotatedFile[] = [];
  const skippedFiles: string[] = [];

  for (const file of files) {
    if (!file.patch || isLikelyGeneratedFile(file.filename)) {
      skippedFiles.push(`${file.filename} (${file.patch ? "generated or vendored" : "no text patch"})`);
      continue;
    }

    const annotated = annotatePatch(file);

    if (annotated.commentableLines.size === 0) {
      skippedFiles.push(`${file.filename} (no added lines)`);
      continue;
    }

    candidates.push(annotated);
  }

  const reviewableFiles: AnnotatedFile[] = [];
  let totalPatchChars = 0;
  let truncated = false;

  for (const file of candidates.sort(compareReviewPriority)) {
    if (reviewableFiles.length >= config.maxFiles) {
      skippedFiles.push(`${file.filename} (file limit)`);
      truncated = true;
      continue;
    }

    if (totalPatchChars + file.annotatedPatch.length > config.maxPatchChars) {
      skippedFiles.push(`${file.filename} (patch budget)`);
      truncated = true;
      continue;
    }

    reviewableFiles.push(file);
    totalPatchChars += file.annotatedPatch.length;
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
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);

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

export function isLikelyGeneratedFile(filename: string): boolean {
  const normalized = filename.toLowerCase();
  const basename = normalized.split("/").pop() ?? normalized;

  if (GENERATED_FILENAMES.has(basename)) {
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

function compareReviewPriority(left: AnnotatedFile, right: AnnotatedFile): number {
  const priorityDelta = reviewPriority(left.filename) - reviewPriority(right.filename);

  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return left.annotatedPatch.length - right.annotatedPatch.length;
}

function reviewPriority(filename: string): number {
  const normalized = filename.toLowerCase();

  if (isDocumentationFile(normalized)) {
    return 4;
  }

  if (isTestFile(normalized)) {
    return 3;
  }

  if (isSourceFile(normalized)) {
    return 0;
  }

  if (isConfigFile(normalized)) {
    return 1;
  }

  return 2;
}

function isSourceFile(filename: string): boolean {
  return SOURCE_EXTENSIONS.has(extensionOf(filename));
}

function isTestFile(filename: string): boolean {
  return /(^|\/)(__tests__|test|tests|spec)\//.test(filename) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(filename);
}

function isDocumentationFile(filename: string): boolean {
  return [".md", ".mdx", ".rst", ".txt"].includes(extensionOf(filename));
}

function isConfigFile(filename: string): boolean {
  const basename = filename.split("/").pop() ?? filename;

  return (
    basename.startsWith(".") ||
    basename.endsWith("rc") ||
    [".json", ".yaml", ".yml", ".toml"].includes(extensionOf(filename))
  );
}

function extensionOf(filename: string): string {
  const basename = filename.split("/").pop() ?? filename;
  const index = basename.lastIndexOf(".");

  return index === -1 ? "" : basename.slice(index);
}
