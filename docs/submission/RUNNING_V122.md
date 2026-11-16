# FormPilot Web V1.2.2 运行说明

产品源码来源：正式 main `9aba92e22a8238fa85d2192dff105881a0af1ce1`。比赛仓库自己的 SHA 见根目录 `SUBMISSION_VERSION.json` 及本轮封版验证记录；两者不能混用。

## Windows 测试包

1. 取得本轮内部 Pre-release 的 `FormPilot-Web-V1.2.2.zip` 和对应 SHA-256；下载访问需要正式 Private 仓库权限。
2. 执行 `Get-FileHash -LiteralPath .\FormPilot-Web-V1.2.2.zip -Algorithm SHA256`，与本轮校验记录比对。旧 V1.2.1 的校验值不可使用。
3. 完整解压到新的目录，双击 `start-formpilot.cmd`；不要在 ZIP 内运行，不覆盖回退包。
4. 平台打开 `http://localhost:4175/`，三游戏服务运行在 `http://localhost:5181/`。保持启动窗口开启，关闭窗口停止服务。
5. 首次训练或游戏允许摄像头。正式体验入口不带 `source=synthetic`、`debug` 等测试参数。

基本包需要 Windows 10/11、PowerShell 5.1+ 和 Edge/Chrome；不需要 Node、pnpm、Python 或大模型。AI Coach 的固定五问、M1/M2 推荐及安全规则无需 Qwen；自由提问需要下文的可选环境。

端口占用时先确认并关闭属于自己的旧服务，再重试；不要批量终止他人进程。平台比赛构建固定连接游戏端口 5181，因此改启动器 `GamesPort` 会造成平台游戏中心连通状态异常。

## 从源码安装

要求 Node.js 22.18+、pnpm 12.5.1；源码运行不需要 Python，恢复媒体/重建 Windows 包需要 Python 3.12。两个应用的锁文件分别安装，从仓库根目录执行：

```powershell
cd apps/platform
pnpm install --frozen-lockfile
cd ../motion-games-lab/app
pnpm install --frozen-lockfile
cd ../../..
```

根 `.env.example` 为参考，不会自动加载。不要提交 `.env.local` 或真实凭据，不复制原工作区依赖。公开视频不在本仓库；有权使用清单内素材时先运行：

```powershell
python scripts/submission/restore_media.py --source-package '<已授权的解压包根目录>'
python scripts/submission/restore_media.py --check
```

该工具只恢复匹配清单的媒体，不下载、不赋予分发权。媒体缺失不妨碍构建和非视频功能，但不能完整复现示范视频。

## 构建与运行

游戏终端，从根目录执行：

```powershell
cd apps/motion-games-lab/app
pnpm build
pnpm preview
```

平台终端，从根目录执行：

```powershell
cd apps/platform
$env:VITE_MOTION_GAMES_URL = 'http://localhost:5181/'
pnpm competition:build
pnpm competition:preview
```

访问 `http://localhost:4175/`。比赛构建启用 M1/M2 ACTIVE；普通 `pnpm build` 为 OFF。游戏中心依次打开摘苹果、林间划船、林间射箭；也可从 `http://localhost:5181/` 大厅进入。三款游戏实际运行源码共享一个游戏服务，不需要另外安装三个应用。游戏成绩与正式训练记录分开。

开发时，游戏用 `pnpm dev --port 5181 --strictPort`；平台用 `pnpm dev --host 127.0.0.1 --port 4173 --strictPort --mode competition`。平台开发页为 `http://127.0.0.1:4173/`。

## 可选 Qwen 自由问答

先由本机环境管理者准备 Ollama 0.40.13 和 `qwen3:4b-instruct-2507-q4_K_M`。模型不在仓库/包内；标签 digest 必须为 `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0`。自行决定下载时可使用 `ollama pull qwen3:4b-instruct-2507-q4_K_M`，安装后核对 digest。源码运行和测试不自动下载模型。

已有环境时，独立终端启动 Ollama：

```powershell
$env:OLLAMA_HOST = '127.0.0.1:11441'
ollama serve
```

平台目录另开终端启动 Bridge：

```powershell
$env:FP_AGENT_ENABLED = 'true'
$env:FP_AGENT_PORT = '4321'
$env:FP_AGENT_OLLAMA_PORT = '11441'
$env:FP_AGENT_MODEL = 'qwen3:4b-instruct-2507-q4_K_M'
$env:FP_AGENT_ORIGINS = 'http://127.0.0.1:4173,http://localhost:4175'
$env:FP_AGENT_PRELOAD = 'false'
pnpm agent:bridge
```

`pnpm agent:bridge` 不自动加载 `.env`。如使用平台目录的 `.env.agent.local` 配置文件，应显式运行 `node --env-file=.env.agent.local server/coachAgent/agent/index.ts`。根模板默认关闭 Bridge，仅复制模板不会启用；前端 Vite 与 Bridge 分别加载自己的配置。Ollama 版本、模型 digest 或工具能力不匹配时会拒绝模型，不应以同名模型标签代替校验。浏览器默认客户端未配置 Bearer Token；若继承了非空 `FP_AGENT_ACCESS_TOKEN`，健康检查可就绪但聊天会被 401 拒绝，应检查本机进程环境，按默认无令牌的本地运行方案配置。

使用解压包时，可运行 `ai-coach-local\start-ai-coach-local.ps1 -OllamaPort 11441`。Bridge 固定本机回环监听，拒绝不匹配的 Origin；若通过 `127.0.0.1:4175` 而非 `localhost:4175` 打开平台，应在明确允许的 Origin 列表中加入该精确值。

进入 AI Coach → 训练问答，待模型就绪后自由提问。使用训练记录时在界面单独授权。首次冷启动耗时受设备影响。没有 Ollama、模型错误/未就绪或 Bridge 缺失时，自由提问不可用，固定五问和其他主功能继续运行；模型回答校验失败会回退规则并标明原因。

## 测试与重建

两个应用目录分别运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:e2e`。系统 Edge 是现有浏览器测试配置的依赖；默认测试含假上游与合成姿态，不能替代真人验收或真实 Qwen 推理。

解压包启动后，平台目录执行 `pnpm exec playwright test -c playwright.package-smoke.config.ts`；游戏目录执行 `pnpm exec playwright test -c playwright.submission.config.ts`。完整素材是四套示范视频播放检查的前提。

从平台目录重新制作 ZIP：

```powershell
python -I -B scripts/competition-package/build_package.py --out '<全新的输出目录>' --version 1.2.2
```

然后回到仓库根目录执行必需的封包步骤：

```powershell
python scripts/submission/finalize_v122_package.py --source-root . --package '<全新的输出目录>/FormPilot-Web-V1.2.2'
```

该步骤补齐 V1.2.2 版本文案、依赖 LICENSE/NOTICE、`FILE_MANIFEST.json`、`SHA256SUMS.txt`，重新生成最终 ZIP 与 `.zip.sha256`。它需要两端已按锁文件安装依赖；不下载模型、不改源码、不赋予媒体分发许可。不要分发未封包的初始 ZIP。

重建封包后必须再次解压、通过包内启动器运行、回归并生成新校验值。[本轮封版验证记录](V122_FINAL_CHECKS.md)与历史 V1.2.1 记录分别保留。
