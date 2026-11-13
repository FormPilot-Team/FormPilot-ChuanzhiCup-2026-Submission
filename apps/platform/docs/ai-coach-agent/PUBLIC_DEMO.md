# AI 教练在线演示（Public Demo Gateway）

状态（2026-11-13）：**代码与部署包已完成，并在本机用真实模型验证；尚未公开上线。** 公开上线需要负责人开通账号 / 授权托管，本仓库不包含任何账号、Key 或公网地址。

## 1. 它是什么

让没有安装模型的人（评委）打开一个网页就能实际使用 V1.2 的 AI 教练自由提问。范围**只有 AI 教练**，不是完整平台：没有摄像头训练、功法视频、动作工坊和体感游戏。

```
访问者浏览器 ──HTTPS（托管平台 / 反向代理）──▶ 演示网关 server/coachAgent/demo（Node 24，无依赖）
  演示页（pnpm demo:build）                          ├─ 静态文件：只有 dist-public-demo（1.7 MB，无视频 / 模型 / 人像）
  runAgentTurn + 5 个只读工具 + RAG + M1/M2           ├─ /v1/coach/agent/health、/chat：与本机 Bridge 相同的 fp-coach-agent/1.2 协议
  （与产品同一份代码，竞赛模式 ACTIVE）                └─ 上游二选一：
  数据 = 内置合成示例数据集（虚构用户，只在内存）          ollama：固定的本机 Qwen3-4B（digest 校验，仅回环）
                                                       openai：OpenAI 兼容 chat-completions（Key 只在网关进程的环境变量里）
```

复用而不是重写：Agent 编排、工具、授权、RAG、M1/M2、输出校验、意图路由都在浏览器端原样运行；网关只替换“模型调用”这一段，请求校验、系统提示、工具 schema 与本机 Bridge 共用（`protocol.ts`、`agent/server.ts`）。

## 2. 数据与隐私

| 项 | 规则 |
| --- | --- |
| 训练记录与画像 | 只用 `src/publicDemo/syntheticDataset.ts` 的合成示例数据（与 V1.2 评测相同的测试夹具：2 次热身 + 2 次八段锦），只在页面内存，不读写访问者的 localStorage |
| 标注 | 页面顶部常驻说明；工具结果带 `dataset` 字段；数据证据标“合成示例”；系统提示要求模型说明是合成示例记录（实测回答会写“此为合成示例记录，非本人实际数据”） |
| 发往模型的内容 | 访问者的提问 + 工具整理后的 JSON（合成记录摘要、推荐结果、知识条目）。不含任何真实训练记录、摄像头画面或个人信息 |
| Key | 只在网关进程环境变量 `FP_DEMO_OPENAI_API_KEY`；不进浏览器、响应、日志、构建产物或仓库 |
| 日志 | 每次模型调用一行：时间、结果码、耗时、访问者哈希（进程级随机盐，不存 IP）、当日用量。不记录问题与回答 |
| 素材 | 演示构建不复制 `public/`：没有功法视频（第三方水印，授权未确认）、姿态轨迹、MediaPipe 模型、教练人像、光球视频、游戏美术；只有项目自有的 F 图标 |

## 3. 防护

- Host / Origin 精确白名单；POST 必须带允许的 Origin。
- 请求校验与本机 Bridge 相同：不能带 system 消息、模型名、额外字段；长度与轮数上限。
- 只转发 5 个白名单工具调用；未知工具 → `INVALID_TOOL_CALL`。
- 限额（默认，可用环境变量调整）：每访问者 20 次模型调用 / 分钟、150 次 / 天；全站 60 次 / 分钟、1500 次 / 天；同时 1 个（ollama）或 2 个（openai）生成。一次提问通常 2–3 次调用。超限返回 `RATE_LIMITED` / `BUDGET_EXCEEDED` / `BUSY`，页面显示原因并用规则回答。
- CSP（`connect-src 'self'`，无外部脚本）、`X-Frame-Options: DENY`（可用 `FP_DEMO_FRAME_ANCESTORS` 允许指定的 https 托管平台嵌入）、`Permissions-Policy` 禁用摄像头 / 麦克风。
- 不对公网开放原始 Ollama 端口或本机 Bridge；网关默认只监听 127.0.0.1。

## 4. 本机运行与验证

```powershell
pnpm demo:build                      # → dist-public-demo/（含 PUBLIC_DEMO_MANIFEST.json，逐文件 SHA-256）
$env:FP_DEMO_ENABLED='true'; $env:FP_DEMO_OLLAMA_PORT='11441'
pnpm demo:gateway                    # → http://127.0.0.1:4330/
pnpm exec playwright test -c playwright.public-demo.config.ts   # 真实模型四问 + 截图 + 对话记录（桌面 + 手机）
```

OpenAI 兼容上游（例如负责人开通的免费云端额度）：

```powershell
$env:FP_DEMO_UPSTREAM='openai'; $env:FP_DEMO_OPENAI_BASE_URL='https://…/v1'; $env:FP_DEMO_OPENAI_MODEL='…'
$env:FP_DEMO_OPENAI_API_KEY='…'      # 只在本终端设置，不写入文件
pnpm demo:upstream-smoke             # 先确认：该模型会调用工具、能根据工具结果作答
```

## 5. 公开上线的两条路径（都需要负责人授权）

| 路径 | 做法 | 需要负责人 | 适合 |
| --- | --- | --- | --- |
| A 容器托管 + 云端免费模型 | `pnpm demo:build && pnpm demo:pack` → `dist-public-demo-deploy/`（Dockerfile，端口 7860）。部署到支持 Docker 的平台（如魔搭 Docker 创空间，Beta），在平台的运行时环境变量里设置上游与 Key、`FP_DEMO_PUBLIC_ORIGINS`、`FP_DEMO_FRAME_ANCESTORS`、`FP_DEMO_TRUST_PROXY` | 平台账号 + 实名；模型服务账号 + 实名 + Key；确认免费额度、条款、数据用途；开启“额度用完即停”之类的防扣费开关 | 评审期间 7×24 可访问 |
| B 负责人电脑 + 临时 HTTPS 隧道 | 本机网关（上游 = 本机 Qwen3-4B）+ 隧道工具把 127.0.0.1:4330 暴露为 https 地址；`FP_DEMO_PUBLIC_ORIGINS=https://<隧道域名>`，`FP_DEMO_TRUST_PROXY` 按隧道设置 | 下载隧道工具；公开网址的授权；电脑与 F 盘全程开机；网址可能每次变化 | 约定时间的现场演示 / 录屏，不适合作为提交材料中的长期网址 |

上线后用 `FP_DEMO_URL=https://… pnpm exec playwright test -c playwright.public-demo.config.ts` 复测四问，再把网址写进材料。

## 6. 已知限制

- 云端模型与本机 4B 不同，评测结论（Agent 26/27、RAG 0.39→0.96）只对本机 Qwen3-4B 成立；换上游后至少要用 `pnpm demo:upstream-smoke` 和四问复测确认，不能直接沿用本机评测数字。
- 不含数字的无依据表述（如“动作流畅性未改善”）校验拦不住。
- 合成示例数据只有 4 条记录，进步比较基于这 4 条。
