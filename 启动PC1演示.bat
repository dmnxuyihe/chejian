@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "PC1_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%PC1_NODE%" set "PC1_NODE=node"
echo Starting PC1 presentation...
echo Keep this window open while using the website.
echo Press Ctrl+C to stop the server.
"%PC1_NODE%" start.js --demo --port=5193
if errorlevel 1 pause
endlocal
