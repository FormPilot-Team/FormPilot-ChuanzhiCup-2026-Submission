@echo off
rem FormPilot V1.2 - optional local AI coach bridge (needs Node.js 22.18+ and a local Ollama with the pinned Qwen3-4B). Downloads nothing.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-ai-coach-local.ps1" %*
pause
