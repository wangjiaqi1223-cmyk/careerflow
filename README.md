# 轻投 CareerFlow · 独立后台部署版

这是可自行部署的蓝白色网站代码包，包含网页、Cloudflare Worker、D1 数据库迁移、后台定时检索和测试。每日检索由 Cloudflare 原生 Cron 执行；没有 ChatGPT 定时任务，也不依赖 ChatGPT 登录、Sites 插件或聊天会话。

**交付状态：代码已准备，尚未部署。** 旧的 `chatgpt.site` 网站不会因为下载此代码包而自动迁移。当前没有真实搜索 API 密钥；测试使用合成岗位数据，未执行真实检索或发送求职邮件。

## 1. 先注册两个服务

| 服务 | 注册入口 | 需要得到什么 | 用途 |
| --- | --- | --- | --- |
| Cloudflare | https://dash.cloudflare.com/sign-up | Cloudflare 账号；随后创建 D1 数据库 | 托管网页、独立后台、定时运行、存储偏好和队列 |
| Brave Search API | https://api-dashboard.search.brave.com/ | 已开通的 Search API 方案及 API Key | 搜索公开 LinkedIn 岗位页面 |

Cloudflare 无需先购买域名，可使用部署后提供的 `workers.dev` 地址。Workers 和 D1 有免费额度；建议先测试，再根据运行日志中的 CPU 和用量决定是否升级。公开多用户使用前应配置 Cloudflare 的访问限流或注册保护。

Brave 在控制台选择方案后，到 API Keys 页面创建密钥。轻投需要把搜索结果保存到岗位队列，请确认所选方案包含 **storage rights（存储结果的权利）**。API 密钥只填写到 Cloudflare Secret，不能写入 `public/` 或提交到 GitHub，也不需要发给聊天助手。

费用参考（2026-10-26 查阅，结算以服务商开通页为准）：Workers Paid 基础费用 $5/月；Brave Search 页面列出的搜索费用为 $5/1,000 次请求，每月 $5 免费额度。存储权利及账户实际可用额度须在选购页核实。这不是固定总费用报价。

官方说明：
- Workers 定价：https://developers.cloudflare.com/workers/platform/pricing/
- D1 定价：https://developers.cloudflare.com/d1/platform/pricing/
- Brave 定价与存储说明：https://brave.com/search/api/
- Brave 密钥创建：https://api-dashboard.search.brave.com/documentation/guides/authentication

## 2. 安装与本地验证

安装 Node.js 22.13 或更高版本，推荐 Node.js 24 LTS。打开终端，进入解压后的 `CareerFlow-independent` 文件夹：

```sh
npm install
npm test
npm run db:local
npm run dev
```

按终端显示的本地地址打开页面。无需真实密钥即可检查页面、保存偏好和队列接口。默认 `SEARCH_ENABLED=0`，不会调用付费搜索。

## 3. 登录 Cloudflare 并创建数据库

```sh
npx wrangler login
npx wrangler d1 create careerflow-db
```

登录会打开 Cloudflare 官方授权页面。数据库创建后，终端会给出 `database_id`。

编辑 `wrangler.jsonc`，把 `d1_databases[0].database_id` 的全零占位值替换为实际 ID。不要把绑定名 `DB` 改掉。若 Worker 名称冲突，可修改最上面的 `name`。

```sh
npm run db:remote
npm run check
npm run deploy
```

首轮部署保持 `SEARCH_ENABLED=0`。记下命令输出的 `https://...workers.dev` 网站地址，打开网页确认“每日找岗位”能读取并保存偏好。

## 4. 配置搜索密钥，然后启用后台

```sh
npx wrangler secret put BRAVE_SEARCH_API_KEY
```

在终端的私密输入提示中粘贴 Brave 密钥。密钥会保存在 Cloudflare；不要修改前端 JavaScript 来加入密钥。

确认 Brave 方案允许保存结果后，将 `wrangler.jsonc` 中 `SEARCH_ENABLED` 改为 `"1"`，然后：

```sh
npm run deploy
```

Cloudflare Cron 配置随代码部署。到 Cloudflare 控制台的 Worker 详情查看触发器及日志，确认触发器存在。Cron 配置传播可能需要时间，以控制台为准。

用户打开网站 → 每日找岗位 → 填写方向和地点 → 勾选每日自动添加 → 保存。之后即使用户关闭浏览器，服务器仍会检索和入队；回到网站刷新即可看到新增岗位。

## 5. 调度与额度

- 统一使用 `Asia/Kuala_Lumpur` 时区（UTC+8），每天 09:00 起分批处理。
- Cron 每 15 分钟检查一次；09:00 前不搜索。每次最多处理 2 个工作空间，每个工作空间每天完成一次。
- 每次每人最多 3 次 API 请求；失败最多再试一次。按候选岗位原始 LinkedIn ID 去重，每人每天最多新增 10 个。
- 每站默认每天最多 300 次搜索请求，失败请求也计入。修改 `DAILY_SEARCH_BUDGET` 后重新部署。此值是代码限制，不是服务商账单保证。
- 此小规模版本每天最多有 120 个处理名额，失败重试也占名额；当用户数或请求预算超出容量时，当天可能无法覆盖所有人。扩大公开用户规模前，应改为 Cloudflare Queues 分发或增加受控处理能力。
- 日内已完成后更改偏好，通常下次日期再运行；暂停后不会再录入新岗位。正在执行的旧偏好结果在写入前会校验版本。
- 预算不足、API 失败或超时会显示在执行记录中。没有匹配结果时如实显示 0，不使用示例岗位凑数。

例如，10 个工作空间每天各查询 3 次，一个 30 天月约 900 次搜索请求；实际费用取决于免费额度、重试、方案和云服务用量。搜索请求次数不等于找到的岗位数。

## 6. 搜索质量与现有功能边界

搜索器仅调用 Brave 的公开网页搜索 API，不登录 LinkedIn、不获取用户 Cookie、不绕过验证码，也不自动在 LinkedIn 提交申请。

采用严格的可解释筛选：
- 只接受 HTTPS LinkedIn `/jobs/view/岗位ID` 链接；
- 标题需要能明确拆出公司、岗位和地点，支持常见英文 `Company hiring Role in Location` 和部分中文招聘标题；无法识别则跳过；
- 岗位名称匹配用户关键词，地点匹配逗号分隔的地点之一；这是文字匹配，不是语义模型；
- 远程开关要求标题或地点明确包含 remote/远程；
- 跳过排除词、已记录岗位和摘要明确标识停止招聘的岗位；
- 搜索限定最近一个月的索引结果；该时间是搜索引擎日期过滤，不保证真实发布日期。

因此，本版不能保证每天恰好找到 10 个，也不能保证岗位当前仍开放。英文及中文别名可一起填写，如 `Product Designer, 产品设计师`；最多前 3 个方向会用于发起查询。申请前需核对原页面。

匿名工作空间使用浏览器内的随机凭据；数据库只保存派生标识。不同浏览器互相隔离。清除浏览器数据后不能找回原队列，跨设备账号同步尚未实现。**清除数据前请先关闭每日检索并保存，否则旧空间仍会消耗后台检索额度。**

简历及邮件正文保存在用户浏览器本机。Gmail 连接界面仍需要 Google OAuth 应用配置和用户授权，发送需用户审核并保持网页打开。默认示例岗位只用于界面体验。公开提供 Gmail 功能还需单独完成 Google 的应用设置；两个基础服务仅解决“每日搜索并入队”。

## 7. 暂停和排查

暂停一个用户：在网站取消每日自动添加并保存。

暂停全站搜索：将 `SEARCH_ENABLED` 改回 `"0"` 后重新部署。仅暂停搜索，不删除队列。

查看日志：

```sh
npx wrangler tail
```

- 网站读写失败：检查 `DB` 绑定及两份迁移是否已应用到远程数据库。
- 显示调度待连接：检查 `SEARCH_ENABLED` 和 `BRAVE_SEARCH_API_KEY`。
- 执行记录显示 HTTP 401/403：检查 Brave 密钥和方案权限。
- HTTP 429：检查额度、付费状态和速率限制。
- 没有结果：尝试用原岗位标题的语言填写关键词及地点；检查排除词和远程要求。
- 无执行记录：检查触发器、马来西亚时间是否已过 09:00、后台处理容量及用户是否开启。

## 8. 验证范围

`npm test` 使用 Node 内置 SQLite 加载真实迁移，验证配额、去重、用户隔离、并发执行认领、暂停和偏好版本、API 错误及有限重试、时区和跨来源请求拒绝。

交付前已运行这些测试和 Wrangler 本地构建检查。尚未进行真实 Cloudflare 远程部署、Brave 实际岗位检索和 Gmail 发信验收；配置账号后应先由管理员用一个工作空间验证完整链路。

## 9. 目录

- `public/`：蓝白色中文网页，前端不包含搜索密钥。
- `src/index.mjs`：访客 API 与 Cloudflare scheduled 入口。
- `src/scheduler.mjs`：定时调度、有限重试和检索流水线。
- `src/search.mjs`：Brave API 和严格结果解析。
- `src/db.mjs`：偏好、配额、执行锁及队列。
- `migrations/`：D1 初始化和调度索引。
- `tests/`：可离线运行的后端测试。
