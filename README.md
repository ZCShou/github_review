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
- `OPENAI_REQUEST_TIMEOUT_MS`: 单次模型请求超时时间
- `OPENAI_MAX_RETRIES`: 可重试模型错误的最大重试次数
- `AUTO_REVIEW_PR_EVENTS`: 是否自动审阅 PR 事件
- `REVIEW_DRAFTS`: 是否审阅 draft PR
- `SKIP_DUPLICATE_REVIEWS`: 是否跳过同一 PR head SHA 的重复自动审阅
- `POST_FAILURE_REVIEWS`: 自动审阅失败时是否在 PR 中发布失败说明
- `ENABLE_REVIEW_SUGGESTIONS`: 是否允许发布 GitHub suggestion block
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

## 部署

项目提供 PM2 和 Caddy 部署模板：

- [deploy/ecosystem.config.cjs](/home/zcs/WORKSPACE/bot/deploy/ecosystem.config.cjs:1)
- [deploy/caddy.review.muxai.net.conf](/home/zcs/WORKSPACE/bot/deploy/caddy.review.muxai.net.conf:1)

示例约定：

- 项目目录：`/opt/tgos-review-bot`
- 本地端口：`3456`
- 域名：`review.muxai.net`
- GitHub App Webhook URL：`https://review.muxai.net/api/github/webhooks`

### 准备项目

```bash
cd /opt
git clone <repo-url> tgos-review-bot
cd /opt/tgos-review-bot
npm ci
cp .env.example .env
nano .env
npm run build
```

生产环境至少需要填写：

- `APP_ID`
- `PRIVATE_KEY`
- `WEBHOOK_SECRET`
- `OPENAI_API_KEY`

建议设置：

```env
PORT=3456
NODE_ENV=production
```

保护环境变量文件：

```bash
chmod 600 .env
```

### PM2

启动：

```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
```

常用命令：

```bash
pm2 status
pm2 logs tgos-review-bot
pm2 restart tgos-review-bot
pm2 stop tgos-review-bot
```

如服务器重启后需要自动恢复 PM2 进程：

```bash
pm2 startup
pm2 save
```

### Caddy

复制站点配置：

```bash
sudo cp deploy/caddy.review.muxai.net.conf /etc/caddy/sites/review.muxai.net.conf
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

确保 `/etc/caddy/Caddyfile` 中包含：

```caddy
import /etc/caddy/sites/*.conf
```

如果使用其他域名，修改 [deploy/caddy.review.muxai.net.conf](/home/zcs/WORKSPACE/bot/deploy/caddy.review.muxai.net.conf:1) 中的域名，并同步修改 GitHub App 的 Webhook URL。

### GitHub App

GitHub App Webhook URL：

```text
https://review.muxai.net/api/github/webhooks
```

Webhook secret 必须和 `.env` 中的 `WEBHOOK_SECRET` 一致。

Repository permissions：

- Contents: read
- Pull requests: read and write
- Issues: read and write
- Metadata: read

Webhook events：

- Pull request
- Issue comment

### 验证

打开一个安装了 GitHub App 的仓库 PR，或在 PR 评论区发送：

```text
/review
```

查看 PM2 日志：

```bash
pm2 logs tgos-review-bot
```

如果 webhook 未到达，优先检查：

- DNS 是否指向服务器
- Caddy 配置是否加载
- GitHub App Webhook URL 是否为 `/api/github/webhooks`
- `WEBHOOK_SECRET` 是否一致
- PM2 进程是否运行在 `PORT=3456`

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
