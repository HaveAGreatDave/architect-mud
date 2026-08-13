@echo off
REM ============================================================================
REM  dev-protocol-launch.bat - what architect:// actually runs.
REM
REM  Registered by scripts\register-dev-protocol.bat. Not meant to be run by hand
REM  (though it is harmless if you do - it is `npm run dev` in a new window).
REM
REM  ####  THE ARGUMENT IS RECEIVED AND DELIBERATELY IGNORED.  ####
REM
REM  %1 is the whole URL the browser followed, e.g. "architect://dev". A registered
REM  protocol handler can be invoked by ANY page in ANY browser on this account -
REM  that is how protocol handlers work, and it is not something this script can
REM  change. What it CAN do is make the reachable surface a single fixed command.
REM
REM  So nothing from the URL reaches a shell, a path, or a command line. There is
REM  no branching on it, no `start %1`, no passing it to node. The worst a hostile
REM  page can achieve by firing architect://anything-at-all is starting a dev
REM  server that was going to be started anyway.
REM
REM  If you ever want architect://<something> to mean more than one thing, do NOT
REM  interpolate the URL - parse it in Node against an explicit allow-list of
REM  literal strings and dispatch from that. Interpolating it into a batch line is
REM  a command injection with a friendly name.
REM ============================================================================
setlocal
cd /d "%~dp0.."

REM Already listening? Then there is nothing to do, and starting a second one just
REM produces "Port 3000 is already in use" and an exit - server/index.js checks.
REM Silent on purpose: the panel is polling the port, not reading this window.
powershell -NoProfile -Command "exit ((Test-NetConnection -ComputerName localhost -Port 3000 -InformationLevel Quiet) -eq $true)" >nul 2>&1
if errorlevel 1 exit /b 0

REM A NEW WINDOW, not this one. The handler process is short-lived and the browser
REM does not wait on it; a server started in-line would die with it. `start` also
REM means the developer gets a real console with the boot log in it, which is the
REM window they will want the moment anything goes wrong.
start "Architect - dev server" cmd /k "npm run dev"
exit /b 0
