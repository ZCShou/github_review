import type { Context } from "probot";

import { prepareDiff } from "./diff.js";
import {
  buildFailureBody,
  buildMissingApiKeyBody,
  buildNoReviewableFilesBody,
  buildReviewBody,
  formatInlineComment,
} from "./format.js";
import { requestModelReview } from "./model.js";
import type { InlineComment, ModelFinding, ModelReview, PullDetails, PullFile, ReviewConfig, ReviewInput } from "./types.js";

const REVIEW_MARKER_PREFIX = "<!-- tgos-review-bot:";

export async function createCodeReview(
  context: Context,
  input: ReviewInput,
  config: ReviewConfig,
): Promise<void> {
  const pullRequest = await getPullRequest(context, input);

  if (input.reason === "pull_request" && config.skipDuplicateReviews) {
    const alreadyReviewed = await hasReviewedHeadSha(context, input, pullRequest.head.sha);

    if (alreadyReviewed) {
      context.log.info({ headSha: pullRequest.head.sha }, "Skipping duplicate review for head SHA.");
      return;
    }
  }

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

    if (input.reason === "manual" || config.postFailureReviews) {
      await submitReview(context, input, pullRequest, {
        body: buildFailureBody(error, files, input.reason),
        comments: [],
      });
    }
  }
}

export function buildInlineComments(
  modelReview: ModelReview,
  preparedDiff: { files: Array<{ filename: string; commentableLines: Set<number> }> },
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
      body: formatInlineComment(finding, config),
    });
  }

  return { comments, downgradedFindings };
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
    body: withReviewMarker(review.body, pullRequest.head.sha),
    comments: review.comments,
  });
}

async function hasReviewedHeadSha(context: Context, input: ReviewInput, headSha: string): Promise<boolean> {
  const reviews = await context.octokit.paginate(context.octokit.rest.pulls.listReviews, {
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
    per_page: 100,
  });

  return reviews.some((review) => typeof review.body === "string" && review.body.includes(reviewMarker(headSha)));
}

function withReviewMarker(body: string, headSha: string): string {
  return `${body}\n\n${reviewMarker(headSha)}`;
}

function reviewMarker(headSha: string): string {
  return `${REVIEW_MARKER_PREFIX} sha=${headSha} -->`;
}
