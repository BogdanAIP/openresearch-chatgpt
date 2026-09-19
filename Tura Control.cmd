@echo off
setlocal
set "LAUNCHER=%~dp0scripts\tura-control-launch.ps1"
where pwsh.exe >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    start "" pwsh.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%LAUNCHER%"
) else (
    start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%LAUNCHER%"
)
endlocal
