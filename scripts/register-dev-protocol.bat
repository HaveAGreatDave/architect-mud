@echo off
REM ============================================================================
REM  register-dev-protocol.bat - teach Windows what architect:// means.
REM
REM    scripts\register-dev-protocol.bat            register (run once)
REM    scripts\register-dev-protocol.bat --remove   unregister
REM
REM  WHY THIS EXISTS
REM  The deployed dev panel has a "Local" button. When the local server is
REM  already running it just navigates and none of this is needed. When it is NOT
REM  running there is a hard wall: a web page cannot start a process on the
REM  machine viewing it, and it should not be able to - that is the whole point of
REM  the sandbox. The Map Studio button looks like a counter-example and is not,
REM  because there the local GAME SERVER is already up and spawns the Studio; here
REM  the game server IS the thing that needs starting.
REM
REM  The one thing a browser can do is follow a URL the operating system knows how
REM  to run. So this registers a protocol handler under HKEY_CURRENT_USER, and
REM  after that "architect://dev" starts the server the same way clicking a mailto:
REM  link opens your mail client.
REM
REM  WHAT IT WRITES - and it is deliberately small enough to read in full:
REM    HKCU\Software\Classes\architect                  (URL Protocol marker)
REM    HKCU\Software\Classes\architect\shell\open\command  -> dev-protocol-launch.bat "%%1"
REM
REM  HKCU, never HKLM: this is one developer's convenience on one account, it
REM  needs no administrator, and it cannot affect anybody else who uses the machine.
REM  Undo the whole thing with --remove, or delete that one key by hand.
REM
REM  SECURITY, PLAINLY. A registered protocol is reachable by ANY page you visit,
REM  not only this panel - that is true of every protocol handler on the system.
REM  Which is exactly why the launcher takes NO arguments from the URL: it ignores
REM  everything after the scheme and runs one hardcoded command in one hardcoded
REM  directory. A hostile page can, at worst, start your dev server. Do not "improve"
REM  this by passing the URL through to a shell - see the note in the launcher.
REM ============================================================================
setlocal
cd /d "%~dp0.."
set "ROOT=%CD%"
set "LAUNCHER=%ROOT%\scripts\dev-protocol-launch.bat"

if /i "%~1"=="--remove" (
  reg delete "HKCU\Software\Classes\architect" /f >nul 2>&1
  if errorlevel 1 (
    echo architect:// was not registered - nothing to remove.
  ) else (
    echo Removed the architect:// handler.
  )
  exit /b 0
)

if not exist "%LAUNCHER%" (
  echo [ERROR] Missing %LAUNCHER%
  echo         It ships alongside this script - re-pull the repo.
  exit /b 1
)

reg add "HKCU\Software\Classes\architect" /ve /d "URL:Architect Dev" /f >nul
reg add "HKCU\Software\Classes\architect" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\architect\shell\open\command" /ve /d "\"%LAUNCHER%\" \"%%1\"" /f >nul

if errorlevel 1 (
  echo [ERROR] Could not write the registry keys.
  exit /b 1
)

echo.
echo   Registered:  architect://  ->  %LAUNCHER%
echo.
echo   The dev panel's "Local" button can now start the server for you.
echo   Your browser will ask permission the first time. Tick the box to stop it asking.
echo.
echo   Undo with:   scripts\register-dev-protocol.bat --remove
echo.
exit /b 0
