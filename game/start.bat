@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Can cai Node.js de chay game: https://nodejs.org
  pause
  exit /b 1
)
echo Dang mo WARGRID: Chi Huy AI ...
node serve.js 5173
pause
