# 匿名反馈服务

客户端通过 HTTPS POST `/feedback` 向固定仓库 `KingsleyAsher/Personal-Knowledge-Base` 创建公开 Issue。用户不需要 GitHub 账号；Issue 作者是服务端令牌所属账号。反馈后端已部署到 `https://knowledge-workbench-feedback.knowledge-workbench-kingsleyasher.workers.dev/feedback`。2026-11-05 已完成真实后端及桌面客户端验证，见 [测试 Issue #46](https://github.com/KingsleyAsher/Personal-Knowledge-Base/issues/46) 与 [#47](https://github.com/KingsleyAsher/Personal-Knowledge-Base/issues/47)，重复提交均返回原 Issue。客户端 1.0.3 为本地交付，公开 Release 尚未更新。

## 部署准备

使用 Cloudflare Workers Free 和 D1 Free。注册、登录、验证及授权由账号持有人完成，不要把密码、验证码或令牌粘贴到聊天、源码或客户端配置。可使用 workers.dev 地址，国内网络可达性须部署后实测。

服务账号需要对目标仓库创建 Issue 的权限。创建 fine-grained PAT 时仅选择此仓库，Repository permissions 只开启 Issues: Read and write，设置有效期；不要给予 Contents 写权限。令牌归属的 GitHub 用户名填入 `GITHUB_ACTOR`。令牌失效需服务端轮换，客户端不接触令牌。

在本目录安装并使用官方 Wrangler CLI，然后执行：

```text
npx wrangler login
npx wrangler d1 create knowledge-workbench-feedback
```

将返回的数据库 ID 填入 `wrangler.jsonc` 中的 `database_id`，再执行：

```text
npx wrangler d1 execute knowledge-workbench-feedback --remote --file schema.sql
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put RATE_SALT
npx wrangler secret put GITHUB_ACTOR
npx wrangler deploy
```

`GITHUB_TOKEN` 为上述 PAT；`RATE_SALT` 使用随机生成的至少 32 字节密钥；`GITHUB_ACTOR` 为令牌所属用户名。密钥仅在 Wrangler 的本地交互提示中输入。不要开启付费计划来绕过配额。

部署后访问 `/health`，应返回 `configured: true`。将真实地址 `https://<部署域名>/feedback` 填入 `apps/desktop/main/feedback-config.json` 的 `endpoint`，再构建新客户端。`KB_FEEDBACK_ENDPOINT` 仅用于维护者隔离测试覆盖。该配置只包含公开端点，不包含任何服务端凭据。空端点会禁用提交，保留复制反馈。

最后通过客户端提交一条明确标为部署测试的非敏感反馈，核对真实 Issue 链接、作者、正文和版本信息，并检查同一提交重试不会创建第二条。未经这个检查，不得将功能描述为已上线。不要用真实用户资料测试。

## 行为与边界

- 仅上传用户确认公开的标题、正文、版本号、构建号和随机请求 ID；不自动采集知识库、日志、路径、账号或设备信息。
- Cloudflare 处理连接 IP。服务用 HMAC 派生匿名限流键，数据库只保存派生键，不保存原始 IP 或反馈正文。平台自身的访问数据处理以其政策为准。
- 每个 IP 每十分钟最多 3 次、每天 10 次新提交；全服务每天最多 100 次。限流无法完全阻止分布式滥用，必要时加 Turnstile 或暂停服务。不得在客户端内嵌共享令牌来充当认证。
- D1 原子抢占请求 ID；相同 ID 不允许改变内容。服务只在 GitHub 返回 201 且 Issue 地址合法时报告创建成功。
- 超时或服务端状态不确定时保留请求，不重复 POST GitHub。重试在最近 100 个 Issue 内匹配服务账号和请求标记；若无法确认，继续显示待确认，需维护者人工处理，不假装失败或成功。
- 数据库保留请求摘要及 Issue 回执以防重试重复；定时清理过期限流键。监控默认关闭，不记录反馈正文或令牌。

接口测试使用 SQLite 适配 D1，并模拟 GitHub 响应。它们不证明 Cloudflare 线上绑定、凭据权限、真实 GitHub 创建或国内网络可用性。

参考：[GitHub 创建 Issue](https://docs.github.com/en/rest/issues/issues#create-an-issue)、[D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)、[Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/)、[D1 定价](https://developers.cloudflare.com/d1/platform/pricing/)。

## 运行时约束

Workers 出站请求使用 `redirect: manual`，不自动跟随跳转，也不使用该运行时不支持的 `redirect: error`。认证头不会被转发到其他站点。客户端使用明确的产品 User-Agent；服务端凭据为 Secret 类型。线上成功验证不代表所有地区和网络都可达。
