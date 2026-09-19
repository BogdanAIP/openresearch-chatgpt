Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$trayScript = Join-Path $PSScriptRoot "tura-control.ps1"
$escapedTrayScript = [Regex]::Escape($trayScript)

$existingTrayProcesses = @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.ProcessId -ne $PID -and
        $_.Name -in @("pwsh.exe", "powershell.exe") -and
        $_.CommandLine -match $escapedTrayScript -and
        $_.CommandLine -notmatch '(?i)\s-Mode\s+(start|stop|restart|toggle)(\s|$)'
    }
)

foreach ($process in $existingTrayProcesses) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Milliseconds 250

$hostPath = $null
$pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
if ($pwsh) {
    $hostPath = $pwsh.Source
} else {
    $powershell = Get-Command powershell.exe -ErrorAction Stop
    $hostPath = $powershell.Source
}

Start-Process -FilePath $hostPath -ArgumentList @(
    "-NoProfile",
    "-STA",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", $trayScript
) -WindowStyle Hidden | Out-Null
