param(
    [ValidateSet("install", "remove")]
    [string]$Action = "install"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$controlCmd = Join-Path $repoRoot "Tura Control.cmd"
$startupDir = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$shortcutPath = Join-Path $startupDir "Tura Indicator.lnk"

if ($Action -eq "remove") {
    Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
    Write-Host "Автозапуск индикатора Tura удалён."
    exit 0
}

if (-not (Test-Path -LiteralPath $controlCmd)) {
    throw "Не найден Tura Control.cmd: $controlCmd"
}

New-Item -ItemType Directory -Force -Path $startupDir | Out-Null

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $controlCmd
$shortcut.WorkingDirectory = $repoRoot
$shortcut.Description = "Tura tray indicator only. Does not start OpenResearch, Tura bridge, or OpenAI Tunnel."
$shortcut.WindowStyle = 7
$shortcut.Save()

Write-Host "Автозапуск индикатора Tura включён."
Write-Host "При входе в Windows запускается только индикатор."
Write-Host "OpenResearch, Tura и OpenAI Tunnel остаются выключенными до ручного включения."
