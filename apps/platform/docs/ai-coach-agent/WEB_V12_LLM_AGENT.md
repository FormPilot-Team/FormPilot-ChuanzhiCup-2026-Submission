# Web V1.2 · AI 教练本地大模型 Agent（LLM + 工具调用 + RAG）

> 状态：2026-11-13 实现并以真实本地模型验证；未合并。证据与报告：`F:\ProjectEvidence\FormPilot\20261113-web-v12-ai-upgrade`（`AI_UPGRADE_HANDOFF.md`）。

## 1. 做了什么

在原 AI Coach「训练问答」面板加入**自由提问**，由**本机运行的 Qwen3-4B-Instruct-2507（Q4_K_M，Apache-2.0）**回答。
固定五问、M1/M2 决策模型、规则推荐、风险暂停全部保留，行为不变。

| 角色 | 由谁负责 | 不允许 |
|---|---|---|
| 理解意图、选择工具、组织语言 | LLM（Qwen3-4B，本机 Ollama） | 生成分数、改写比较结论、绕过工具、写任何数据 |
| 训练推荐排序 | M1/M2 决策模型 + 规则（`recommendCoachDecision`，原逻辑） | 被 LLM 替换 |
| 风险暂停、医疗边界、候选范围、输出校验、回退 | `guard.ts` + `router.ts` + `agent.ts`（确定性代码） | 依赖模型自觉 |
| 读取真实数据 | 只读工具 → 原有 Reader / Dispatcher / 授权 / 报告分析 | 绕过授权；读取未勾选的数据 |

## 2. 架构

```
浏览器 CoachAgentChat ──NDJSON──▶ 本地 Agent Bridge (127.0.0.1:4321, server/coachAgent/agent)
   │  runAgentTurn (src/features/coachLlm/agent.ts)            │  Origin 白名单 + Host 校验 + 速率/预算/单并发
   │   1 guard：急性风险 / 改数据请求 → 安全规则回答（不调模型）   │  固定模型 tag + digest（verifyInstalledModel）
   │   2 模型选择工具（原生 function calling，最多 3 轮 5 次）   └──▶ Ollama 0.40.13 (127.0.0.1:11441, F:\AI)
   │   3 浏览器内执行只读工具（授权、校验、报告同一算法）              └─ qwen3:4b-instruct-2507-q4_K_M
   │   4 意图路由兜底：模型未调用应调的工具 → 代码补调并让模型重答
   │   5 模型基于工具结果作答（Bridge 流式传给 runAgentTurn；界面只显示进度字数）
   │   6 validateAnswer：医疗承诺/诊断/写操作声明/目录外推荐/无出处数字 → 规则回答
   └─ UI：工具进度、生成进度、校验通过后显示回答、[K#] 依据可展开、模型来源、回退原因
```

**显示规则**：模型文本只在通过 `validateAnswer` 后显示。生成过程中界面只显示「模型已生成 N 字，校验通过后显示…」与「安全与证据校验」进度；校验失败直接显示规则回答，未通过的文本从未出现在屏幕上（E2E F 用逐段推送的假 Bridge 验证）。

工具在浏览器内执行：训练记录只在本机 localStorage，模型只看到工具整理后的 JSON，不上传任何数据。
模型在本机运行，不联网（`OLLAMA_NO_CLOUD`），没有任何 API Key。

### 工具（function calling，`protocol.ts`）

| 工具 | 读取 | 复用 |
|---|---|---|
| `search_knowledge(query, topic)` | 知识库（BM25 + 实体链接），返回带 `[K#]` 的条目与出处 | 评分标准注册表 `CRITERIA` / `SCORING_SOURCES`、功法章节、热身动作 |
| `get_catalog(kind)` | 功法、章节、热身动作、体感游戏目录 | 原目录 |
| `recommend_training()` | 本页已确认画像的推荐结果 | `recommendCoachDecision`（M1/M2 + 规则，原逻辑） |
| `read_last_training(kind)` | 最近一次热身 / 功法记录的报告结论 | `createCoachSessionReader` + `createCoachToolDispatcher`（授权）+ `analyzeTraining` / `buildRoutineReport` |
| `compare_recent_training(kind)` | 报告页同一比较规则的结论 | `analysis.comparison` / `report.comparison`（合成数据、不同标准不比较） |

全部只读。没有写工具；「把分数改成 100」类请求在调用模型前被规则拒绝。

### 为什么是 Function Calling 而不是 MCP

赛题「MCP/工具集成」明确接受 MCP **或** Function Calling。本应用的工具需要读浏览器本地记录并复用页面内的授权状态，用 MCP 需要再做一个能访问浏览器存储的服务进程，会把私人记录搬出浏览器，且不增加能力。因此 V1.2 只用原生 function calling（Ollama `tools`），工具 schema 与校验集中在 `protocol.ts`。没有为了写上「MCP」而做未使用的 MCP 服务。

## 3. RAG

* 语料：由产品注册表在运行时生成 220 条（评分条目 127、功法章节 60、出处 19、热身动作 6、功法 4、安全 4）；每条带出处与核验状态（全文核验 / 元数据核验 / 待核验 / FormPilot 规则）。
* 检索：中文单字 + 双字 BM25（标题 2、关键词 2.5、正文 1 权重），功法 / 章节 / 「第N式」实体链接加权，跑题惩罚；分数不足返回 `insufficient`，模型被要求说「资料不足」。
* 生成：工具结果中的 `[K#]` 由模型引用；未知编号与模型自造标记（如「[规则1]」「[原因1]」）被删除；引用可在 UI 展开到原文条目和出处链接。
* 实测（20 题，本机 Qwen3-4B）：事实召回 无 RAG 0.39 → RAG 0.96，规则模板 0.87；19/20 回答带引用，57/65 引用与题目相关。

## 4. 安全边界（代码保证，不依赖模型）

* 疼痛加重、剧痛、眩晕、扭伤等 → 立即「先停下来」安全规则回答，不调用模型；画像风险 → 推荐工具返回暂停。
* 不诊断、不承诺疗效：医疗承诺 / 诊断 / 医疗问题中的疗效声明 → 拒绝模型文本，改用工具结果的规则渲染；医疗问题附固定提示。
* 不改训练强度与评分规则；工具只读；「已修改评分」类声明被拒绝。
* 分数与比较：答案中的数字必须出现在本轮工具结果中，否则回退；合成 / 演示数据与不可比记录由原比较规则拦截。
* 适配度标注为「候选内相对适配度，不是医学概率」。
* 提示注入：系统提示和工具权限在应用代码中，用户文本不能增加工具或写权限；注入原话不会被回显。
* 记录读取需要在对话框勾选「允许 AI 教练读取此浏览器中的热身与功法训练记录」，否则工具返回 `NOT_AUTHORIZED`。
* 模型文本与证据分开：依据面板只显示工具结果；回答来源始终标注（本机大模型生成 / 规则回答 / 安全规则回答）。

## 5. 运行

本地演示环境（Windows，已按 F:\AI 批准目录部署 Ollama 0.40.13 与模型）：

```powershell
# 1) Ollama（批准的 F: 运行目录；端口 11441）
F:\ProjectEvidence\FormPilot\20261113-web-v12-ai-upgrade\llm\runtime\start-ollama-11441.cmd
# 2) Agent Bridge（另开终端，apps/platform 目录）
$env:FP_AGENT_ENABLED='true'; $env:FP_AGENT_OLLAMA_PORT='11441'; $env:FP_AGENT_PRELOAD='true'
$env:FP_AGENT_ORIGINS='http://127.0.0.1:4173,http://localhost:4175'
pnpm agent:bridge        # = node server/coachAgent/agent/index.ts（Node 24 直接运行 TS）
# 3) Web
pnpm dev --host 127.0.0.1 --port 4173      # 或 competition:build + competition:preview（4175）
```

环境变量模板见 [`agent.env.example`](agent.env.example)。没有 API Key。

| 环境 | 自由提问 | 说明 |
|---|---|---|
| 普通 Web 构建 | 本机 Bridge 可用时启用 | 打开「训练问答」后才探测 127.0.0.1:4321；探测失败显示「未连接」，输入框禁用 |
| 比赛轻量包（competition build） | 同上；包内不含模型 | 模型不进安装包；评委机没有 Bridge 时自动回到固定五问 + M1/M2。已装好模型环境的电脑可用包内 `ai-coach-local/start-ai-coach-local.cmd` 一键启动 Bridge（不下载任何东西） |
| LLM 演示环境 | 启用 | Ollama(F:) + Bridge + dev/preview |
| 无 LLM 回退 | 禁用 | `VITE_COACH_AGENT=off` 构建完全不探测；固定五问、推荐、风险规则不受影响 |
| 在线演示（只含 AI 教练） | 演示网关可用时启用 | `pnpm demo:build` + `pnpm demo:gateway`；合成示例数据；见 [PUBLIC_DEMO.md](PUBLIC_DEMO.md)。**尚未公开上线** |

## 6. 测试

| 测试 | 内容 | 模型 |
|---|---|---|
| `tests/coach-llm-*.test.ts` | 检索、guard、router、agent 编排（脚本化假传输）、工具 | 无（标注 FAKE） |
| `tests/coach-agent-bridge-v12.test.ts` | Bridge 边界：Origin/Host、固定模型、请求校验、工具白名单、限流、预加载 | 假 Ollama |
| `tests/e2e/web-v12-agent.spec.ts` | UI：就绪 / 不可用 / 安全规则 / 校验回退 / 报告跳转 + 授权读取 / 逐段推送的危险草稿从不显示（F） | 假 Bridge（标注） |
| `tests/coach-agent-demo-gateway.test.ts` | 演示网关：Host/Origin、静态白名单、Key 不外泄、OpenAI 兼容转换、限额、并发、Ollama 上游 | 假上游 |
| `playwright.public-demo.config.ts` | 在线演示四问（桌面 + 手机）、合成数据标注、无第三方请求 | **真实模型**（经网关） |
| `tests/llm-eval/agent.eval.ts` | 26 题 Agent 任务集 | **真实本机模型** |
| `tests/llm-eval/rag.eval.ts` | 20 题 无RAG / RAG / 规则 三组对比 | **真实本机模型** |

真实模型评测：`FP_EVAL_OUT=<dir> pnpm exec vitest run -c vitest.llm-eval.config.ts tests/llm-eval/agent.eval.ts`（需 Bridge 就绪；默认测试不运行它们）。

## 7. 已知限制

* 4B 模型在无工具时会编造功法要领（无 RAG 事实召回 0.39）；V1.2 用意图路由强制先查资料，不靠模型自觉。
* 冷启动：模型首次从 USB F: 盘载入约 36.5 s；Bridge 支持 `FP_AGENT_PRELOAD=true` 提前载入。
* 知识库中 44 条引用来自「待核验」出处，UI 如实显示核验状态。
* 评测数据为测试夹具（分析测试集的标准热身会话 + 生成的功法记录），不是真人训练。
* 模型只读文本证据，不看图像；「多模态」= 摄像头姿态识别（MediaPipe）→ 结构化报告 → 模型解释，没有大模型视觉能力。
