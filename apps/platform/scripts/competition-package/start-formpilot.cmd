@echo off
rem FormPilot Web V1.2 - double-click to start (Windows). Keep the window open while presenting.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-formpilot.ps1" %*
pause
