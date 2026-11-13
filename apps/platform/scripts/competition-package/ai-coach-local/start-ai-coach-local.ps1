# FormPilot V1.2 · 本机 AI 教练（自由提问）启动器 — 可选。只用于已经装好模型环境的电脑。
# 作用：检查 Node.js 与本机 Ollama，然后启动本机 Agent Bridge（只监听 127.0.0.1:4321，只允许 http://localhost:4175 页面访问）。
# 不下载任何东西，不安装软件，不联网，不需要 API Key。没有模型环境时，竞赛包其余功能照常使用，自由提问显示“未连接”。
# 需要：Node.js 22.18 及以上；Ollama 0.40.13 正在运行，并已安装 qwen3:4b-instruct-2507-q4_K_M（固定 digest 0edcdef34593…）。
# 用法：先双击 start-formpilot.cmd，再双击本目录的 start-ai-coach-local.cmd。Ollama 不在默认端口时：
#   powershell -NoProfile -ExecutionPolicy Bypass -File start-ai-coach-local.ps1 -OllamaPort 11441
param(
  [int]$OllamaPort = 11434,
  [int]$BridgePort = 4321
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host '未找到 Node.js（需要 22.18 及以上）。自由提问不可用；竞赛包其余功能不受影响。' -ForegroundColor Yellow; exit 1 }
$version = (& node --version).TrimStart('v').Split('.')
if ([int]$version[0] -lt 22 -or ([int]$version[0] -eq 22 -and [int]$version[1] -lt 18)) { Write-Host "Node.js 版本过低：$(& node --version)，需要 22.18 及以上。" -ForegroundColor Yellow; exit 1 }

try {
  $ollama = Invoke-RestMethod -Uri "http://127.0.0.1:$OllamaPort/api/version" -TimeoutSec 3
  Write-Host "已连接本机 Ollama $($ollama.version)（127.0.0.1:$OllamaPort）"
  if ($ollama.version -ne '0.40.13') { Write-Host '注意：Bridge 只接受经过验收的 Ollama 0.40.13；版本不同时页面会显示“模型文件未通过校验”。' -ForegroundColor Yellow }
} catch {
  Write-Host "127.0.0.1:$OllamaPort 上没有运行 Ollama。请先启动本机 Ollama（或用 -OllamaPort 指定端口）。本脚本不会下载或安装模型。" -ForegroundColor Yellow
  exit 1
}

$env:FP_AGENT_ENABLED = 'true'
$env:FP_AGENT_PORT = "$BridgePort"
$env:FP_AGENT_OLLAMA_PORT = "$OllamaPort"
$env:FP_AGENT_ORIGINS = 'http://localhost:4175,http://127.0.0.1:4175'
$env:FP_AGENT_PRELOAD = 'true'
Write-Host '启动本机 Agent Bridge：http://127.0.0.1:4321（保持此窗口打开；关闭窗口即停止）。首次载入模型约 40 秒。'
Set-Location $root
& node 'server/coachAgent/agent/index.ts'
