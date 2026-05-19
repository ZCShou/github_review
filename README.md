# tgosbot

## 简介

tgosbot 是一个基于 GitHub App 的 AI PR Review 机器人。它会读取 PR diff，调用 DeepSeek 或 OpenAI-compatible 模型生成结构化审阅结果，并把可定位的问题发布为 GitHub inline review comments。

主要能力：

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
  -> DeepSeek or OpenAI-compatible review model
  -> Finding validator
  -> GitHub review with inline comments
```

核心流程：

1. Probot 接收 GitHub App webhook。
2. 机器人通过 GitHub API 拉取 PR 元信息和 changed files。
3. `patch` 会被标注为可评论的新文件行号，例如 `R42 + ...`。
4. 模型返回结构化 JSON，包括 summary、findings 和 general comments。
5. 机器人校验每条 finding 的 `path` 和 `line` 是否存在于当前 diff 的新增行。
6. 校验通过的 finding 作为 inline comment 发布；其他意见进入总评。

## 部署

### 1. 创建 GitHub App

注意：必须创建 `GitHub App`，不要创建 `OAuth App`。`Client secrets` 不是本项目需要的凭据，本项目需要 GitHub App 的 `Private keys`。

个人账号入口：

```text
GitHub -> Settings -> Developer settings -> GitHub Apps -> New GitHub App
```

组织账号入口：

```text
Organization -> Settings -> Developer settings -> GitHub Apps -> New GitHub App
```

建议填写：

- GitHub App name: `tgosbot`
- Homepage URL: 项目仓库地址或服务地址
- Webhook URL:
  - 本地调试：Smee URL
  - 服务器部署：`https://review.muxai.net/api/github/webhooks`
- Webhook secret: 自己生成随机字符串，并写入 `.env` 的 `WEBHOOK_SECRET`

一键生成安全的 `WEBHOOK_SECRET`：

```bash
openssl rand -hex 32
```

创建完成后，在 GitHub App 设置页的 General 页面下获取：

- `APP_ID`: 页面顶部的 App ID
- `PRIVATE_KEY`: 页面底部 `Private keys` 区域点击 `Generate a private key` 下载 `.pem` 文件

如果页面只看到 `Client secrets`，继续在同一个 `General` 页面向下滚动查找 `Private keys`。如果仍然没有 `Private keys` 区域，通常说明当前进入的是 `OAuth Apps`，需要返回 `Developer settings -> GitHub Apps`。

把 `.pem` 内容写入 `.env`：

```env
PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

也可以用脚本从 `.pem` 生成一行 `.env` 格式：

```bash
node -e 'const fs=require("fs"); console.log("PRIVATE_KEY=" + JSON.stringify(fs.readFileSync("your.private-key.pem","utf8")))'
```

### 2. 配置 GitHub App 权限

在 GitHub App 设置页的 Permissions & events 页面中的 Repository permissions：

- Contents: read
- Pull requests: read and write
- Issues: read and write, only required for `/review` comments
- Metadata: read

这些默认值也写在 [app.yml](/home/zcs/WORKSPACE/bot/app.yml:1) 中，可用于 GitHub App manifest setup。

然后在同一个 `Permissions & events` 页面找到 `Subscribe to events`，勾选其中的如下两个，最后在底部点击 `Save changes`：

- Pull request
- Issue comment

### 3. 配置环境变量

复制配置模板：

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

必填 GitHub App 配置：

- `APP_ID`
- `PRIVATE_KEY`
- `WEBHOOK_SECRET`

必填 AI 审阅配置：

- `AI_API_KEY`

DeepSeek 默认配置：

```env
AI_PROVIDER=deepseek
AI_API_KEY=sk-...
AI_MODEL=deepseek-v4-pro
AI_BASE_URL=https://api.deepseek.com
REASONING_EFFORT=high
```

如需切换到 OpenAI-compatible provider：

```env
AI_PROVIDER=openai
AI_API_KEY=sk-...
AI_MODEL=gpt-5.5
AI_BASE_URL=https://api.openai.com/v1
REASONING_EFFORT=medium
```

常用可选配置：

- `AI_REQUEST_TIMEOUT_MS`: 单次模型请求超时时间
- `AI_MAX_RETRIES`: 可重试模型错误的最大重试次数
- `AUTO_REVIEW_PR_EVENTS`: 是否自动审阅 PR 事件
- `REVIEW_DRAFTS`: 是否审阅 draft PR
- `SKIP_DUPLICATE_REVIEWS`: 是否跳过同一 PR head SHA 的重复自动审阅
- `POST_FAILURE_REVIEWS`: 自动审阅失败时是否在 PR 中发布失败说明
- `ENABLE_REVIEW_SUGGESTIONS`: 是否允许发布 GitHub suggestion block
- `REVIEW_MAX_FILES`: 单次送审最大文件数
- `REVIEW_MAX_PATCH_CHARS`: 单次送审最大 patch 字符数
- `REVIEW_MAX_INLINE_COMMENTS`: 单次 review 最多 inline 评论数

完整说明见 [.env.example](/home/zcs/WORKSPACE/bot/.env.example:1)。

### 4. 本地部署

安装依赖并构建：

```bash
npm install
cp .env.example .env
npm run build
```

本地接收 GitHub webhook 需要公网转发。可以创建 Smee channel，并把地址写入 `.env`：

```env
WEBHOOK_PROXY_URL=https://smee.io/your-channel
```

启动：

```bash
npm start
```

然后把 GitHub App 的 Webhook URL 临时设置为 Smee URL。

### 5. 服务器部署

项目提供 PM2 和 Caddy 部署模板：

- [deploy/pm2/ecosystem.config.cjs](/home/zcs/WORKSPACE/bot/deploy/pm2/ecosystem.config.cjs:1)
- [deploy/caddy/review.muxai.net.conf](/home/zcs/WORKSPACE/bot/deploy/caddy/review.muxai.net.conf:1)

示例约定：

- 项目目录：任意目录，例如 `~/tgosbot` 或 `/opt/tgosbot`
- 本地端口：`3456`
- 域名：`review.muxai.net`
- GitHub App Webhook URL：`https://review.muxai.net/api/github/webhooks`

准备项目：

```bash
git clone <repo-url> tgosbot
cd tgosbot
npm ci
cp .env.example .env
nano .env
npm run build
chmod 600 .env
```

建议设置：

```env
PORT=3456
NODE_ENV=production
AI_PROVIDER=deepseek
AI_MODEL=deepseek-v4-pro
AI_BASE_URL=https://api.deepseek.com
```

启动 PM2：

```bash
pm2 start deploy/pm2/ecosystem.config.cjs
pm2 save
```

PM2 配置会自动以项目根目录作为 `cwd`，并在启动时先执行 `npm run build`，因此 `lib/index.js` 不需要提交到仓库。日志使用 PM2 默认位置，通常是当前用户的 `~/.pm2/logs`。

常用 PM2 命令：

```bash
pm2 status
pm2 logs tgosbot
pm2 restart tgosbot
pm2 stop tgosbot
```

如果改过 PM2 配置，重新加载：

```bash
pm2 delete tgosbot
pm2 start deploy/pm2/ecosystem.config.cjs
pm2 save
```

如服务器重启后需要自动恢复 PM2 进程：

```bash
pm2 startup
pm2 save
```

配置 Caddy：

```bash
sudo cp deploy/caddy/review.muxai.net.conf /etc/caddy/sites/review.muxai.net.conf
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

确保 `/etc/caddy/Caddyfile` 中包含：

```caddy
import /etc/caddy/sites/*.conf
```

如果使用其他域名，修改 [deploy/caddy/review.muxai.net.conf](/home/zcs/WORKSPACE/bot/deploy/caddy/review.muxai.net.conf:1) 中的域名，并同步修改 GitHub App 的 Webhook URL。

### 6. 部署排查

检查 PM2：

```bash
pm2 status
pm2 logs tgosbot --lines 50
```

检查本地端口：

```bash
ss -lntp | grep 3456
curl -i http://127.0.0.1:3456/api/github/webhooks
```

检查 Caddy 和域名：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
curl -Iv https://review.muxai.net/api/github/webhooks
dig +short review.muxai.net
```

如果 GitHub Webhook 显示 `failed to connect to host`，优先检查：

- DNS 是否指向服务器
- Caddy 配置是否加载
- GitHub App Webhook URL 是否为 `/api/github/webhooks`
- 服务器 80/443 是否开放
- PM2 进程是否运行在 `PORT=3456`
- 是否执行过 `npm ci` 和 `npm run build`

## 使用

### 1. 安装到仓库

进入 GitHub App 页面，点击 `Install App`，选择账号或组织，然后选择：

- All repositories
- 或 Only select repositories

建议先安装到测试仓库，确认 review 行为符合预期后再扩大范围。

### 2. 自动审阅

安装完成后，目标仓库中的 PR 会在这些事件触发自动审阅：

- PR opened
- PR reopened
- PR synchronize, 即 push 新 commit 到 PR 分支

机器人会提交一条 GitHub Review。能定位到新增行的问题会作为 inline comment；无法定位的问题会进入 review summary。

### 3. 手动触发

在 PR 评论区发送：

```text
/review
```

机器人会立即对该 PR 执行一次审阅。

### 4. 部署后验证

1. 确认 GitHub App 已安装到目标仓库。
2. 在目标仓库创建一个测试 PR。
3. 修改一段代码并 push。
4. 查看 PR Conversation 或 Files changed 页面是否出现 tgosbot review。
5. 如果没有自动触发，在 PR 评论区发送 `/review`。
6. 查看服务器日志：

```bash
pm2 logs tgosbot --lines 100
```

如果 GitHub App delivery 页面显示 `events: []`，说明 `Subscribe to events` 没有勾选 `Pull request` 和 `Issue comment`。

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
