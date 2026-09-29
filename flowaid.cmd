@echo off
rem FlowAId: one command to run it on your own computer (Windows; ./flowaid on macOS and Linux).
rem
rem   flowaid                 start FlowAId: it opens in its own window, with its icon in the
rem                           notification area (the system tray)
rem   flowaid --pageindex     also run PageIndex (PDF document indexes; needs Python 3.10+)
rem   flowaid --help          every option (they are `pnpm start` options)
rem
rem Works from Command Prompt (flowaid) and PowerShell (.\flowaid). It checks Node.js and pnpm,
rem then hands over to scripts\start.ts, the same entry point as `pnpm start`.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo flowaid: Node.js 24+ is required: install it from https://nodejs.org 1>&2
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%v"
if %NODE_MAJOR% LSS 24 (
  echo flowaid: Node.js %NODE_MAJOR% is too old: FlowAId needs 24 or newer ^(https://nodejs.org^) 1>&2
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo Enabling pnpm through Corepack...
  call corepack enable >nul 2>nul
  where pnpm >nul 2>nul
  if errorlevel 1 (
    echo flowaid: pnpm is required: run `npm install -g pnpm` and try again 1>&2
    exit /b 1
  )
)

node --disable-warning=ExperimentalWarning scripts\start.ts %*
exit /b %ERRORLEVEL%
