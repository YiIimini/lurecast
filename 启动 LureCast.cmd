@echo off
rem LureCast launcher: start local server + open browser
chcp 65001 >nul 2>&1
cd /d "%~dp0"
set "PSEXE=powershell"
where pwsh >nul 2>&1 && set "PSEXE=pwsh"
"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-server.ps1" %*
if errorlevel 1 pause
ping -n 2 127.0.0.1 >nul
