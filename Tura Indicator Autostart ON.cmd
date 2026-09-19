@echo off
setlocal
set "SCRIPT=%~dp0scripts\tura-indicator-autostart.ps1"
where pwsh.exe >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Action install
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Action install
)
endlocal
