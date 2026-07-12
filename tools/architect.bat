@echo off
cd /d "%~dp0.."
setlocal enabledelayedexpansion

echo Which command do you want to run?
echo   [Enter] just open here (no command)
echo   [1] npm run dev
echo   [2] node ./tools/zone-planner/serve.mjs   (map server)
echo   [3] npm run content:export
echo   [4] npm run test:regress
echo   [5] npm run content:status
echo   [6] npm run content:lint
echo   [7] npm run content:import
echo   [8] npm run db:schema
echo.

set "choice="
set "cmd="
set "url="
set /p "choice=Enter number (or just Enter to open here): "

if "%choice%"=="" goto :nocmd
if "%choice%"=="1" ( set "cmd=npm run dev" & set "url=http://localhost:3000" )
if "%choice%"=="2" ( set "cmd=node ./tools/zone-planner/serve.mjs" & set "url=http://localhost:5178" )
if "%choice%"=="3" set "cmd=npm run content:export"
if "%choice%"=="4" set "cmd=npm run test:regress"
if "%choice%"=="5" set "cmd=npm run content:status"
if "%choice%"=="6" set "cmd=npm run content:lint"
if "%choice%"=="7" set "cmd=npm run content:import"
if "%choice%"=="8" set "cmd=npm run db:schema"

if not defined cmd (
    echo Invalid choice "%choice%" - opening here without running anything.
    goto :nocmd
)

if defined url start "" "%url%"

echo.
echo ^> !cmd!
echo.
call !cmd!

pause
goto :eof

:nocmd
echo.
echo Opened at %CD% - no command run.
echo.
cmd /k