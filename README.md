# tgos-review-bot

tgos-review-bot 是一个基于 GitHub App 的 AI PR Review 机器人。它会读取 PR diff，调用 OpenAI-compatible 模型生成结构化审阅结果，并把可定位的问题发布为 GitHub inline review comments。

## 简介

- 自动响应 `pull_request.opened`、`pull_request.reopened`、`pull_request.synchronize`。
- 支持在 PR 评论区发送 `/review` 手动触发审阅。
- 只在 GitHub 当前 diff 可定位的新增行上发布 inline comment。
- 无法定位到具体 diff 行的问题会降级到 review summary。
- 默认使用 `event: "COMMENT"`，不会自动 approve 或 request changes。
- 会跳过 lockfile、generated/vendor 文件、二进制文件和超出预算的大 diff。

## 架构

```text
GitHub Webhook
  -> Probot event handler
  -> Pull Request files and patch loader
  -> Diff annotator
  -> OpenAI-compatible review model
  -> Finding validator
  -> GitHub review with inline comments
```

核心流程：

1. Probot 接收 GitHub App webhook。
2. 机器人通过 GitHub API 拉取 PR 元信息和 changed files。
3. `patch` 会被标注为可评论的新文件行号，例如 `R42 + ...`。
4. 模型只返回结构化 JSON，包括 summary、findings 和 general comments。
5. 机器人校验每条 finding 的 `path` 和 `line` 是否存在于当前 diff 的新增行。
6. 校验通过的 finding 作为 inline comment 发布；其他意见进入总评。

## 使用

### GitHub App 权限

Repository permissions:

- Contents: read
- Pull requests: read and write
- Issues: read and write, only required for `/review` comments

Webhook events:

- Pull request
- Issue comment

这些默认值也写在 [app.yml](/home/zcs/WORKSPACE/bot/app.yml:1) 中，可用于 GitHub App manifest setup。

### 本地启动

```bash
npm install
cp .env.example .env
npm run build
npm start
```

本地 webhook 调试可以创建 Smee channel，并把地址写入 `.env` 的 `WEBHOOK_PROXY_URL`。

### 配置

必填 GitHub App 配置：

- `APP_ID`
- `PRIVATE_KEY`
- `WEBHOOK_SECRET`

必填 AI 审阅配置：

- `OPENAI_API_KEY`

常用可选配置：

- `OPENAI_MODEL`: 审阅模型，默认 `gpt-5.5`
- `OPENAI_REASONING_EFFORT`: 推理强度，默认 `medium`
- `OPENAI_BASE_URL`: OpenAI-compatible API 地址
- `AUTO_REVIEW_PR_EVENTS`: 是否自动审阅 PR 事件
- `REVIEW_DRAFTS`: 是否审阅 draft PR
- `REVIEW_MAX_FILES`: 单次送审最大文件数
- `REVIEW_MAX_PATCH_CHARS`: 单次送审最大 patch 字符数
- `REVIEW_MAX_INLINE_COMMENTS`: 单次 review 最多 inline 评论数

完整说明见 [.env.example](/home/zcs/WORKSPACE/bot/.env.example:1)。

### 手动触发

在 PR 评论区发送：

```text
/review
```

机器人会立即对该 PR 执行一次审阅。

## 贡献

欢迎提交 issue 和 pull request。建议在提交前运行：

```bash
npm test -- --run
npm run build
```

贡献时请尽量保持以下原则：

- 优先保证 review 评论可定位、可执行、低噪音。
- 不要让机器人自动 approve 或 request changes，除非项目策略明确要求。
- 新增 diff 解析、过滤规则或模型输出处理时，请补充对应测试。
- 不要提交 `.env`、`node_modules/`、`lib/`、日志或本地缓存文件。

## 协议

本项目采用 Apache License 2.0 协议。
