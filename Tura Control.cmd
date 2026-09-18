@echo off
setlocal
set "SCRIPT=%~dp0scripts\tura-control.ps1"
where pwsh.exe >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    start "" pwsh.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT%"
) else (
    start "" powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT%"
)
endlocal
