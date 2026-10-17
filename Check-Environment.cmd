@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\check-environment.ps1" %*
set "CHECK_RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %CHECK_RESULT%
