import type { Probot } from "probot";

import { readReviewConfig } from "./config.js";
import { createCodeReview } from "./review.js";

const REVIEW_COMMAND = "/review";

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

      await createCodeReview(
        context,
        {
          ...context.repo(),
          pullNumber: pullRequest.number,
          reason: "pull_request",
        },
        config,
      );
    },
  );

  app.on("issue_comment.created", async (context) => {
    const issue = context.payload.issue;
    const body = context.payload.comment.body.trim();

    if (!issue.pull_request || body !== REVIEW_COMMAND) {
      return;
    }

    await createCodeReview(
      context,
      {
        ...context.repo(),
        pullNumber: issue.number,
        reason: "manual",
      },
      readReviewConfig(),
    );
  });
};
