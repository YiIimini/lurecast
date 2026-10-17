@echo off
rem LureCast: stop local server
chcp 65001 >nul 2>&1
cd /d "%~dp0"
set "PSEXE=powershell"
where pwsh >nul 2>&1 && set "PSEXE=pwsh"
"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-server.ps1"
ping -n 3 127.0.0.1 >nul
