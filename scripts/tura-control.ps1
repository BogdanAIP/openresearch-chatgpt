Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TuraNativeMethods {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool DestroyIcon(IntPtr hIcon);
}
"@

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Alias = "openresearch"
$McpUrl = "http://127.0.0.1:8787/mcp"
$BridgeHealthUrl = "http://127.0.0.1:8787/health"
$OpenResearchHealthUrl = "http://127.0.0.1:4791/api/health"
$ProfileDir = Join-Path $env:APPDATA "tunnel-client"
$TunnelIdFile = Join-Path $RepoRoot "runtime\openresearch-tunnel-id.txt"
$StateDir = Join-Path $env:LOCALAPPDATA "OpenResearchChatGPT"
$RuntimeKeyFile = Join-Path $StateDir "openresearch-runtime-key.dpapi"
$LogDir = Join-Path $StateDir "logs"

New-Item -ItemType Directory -Force $StateDir | Out-Null
New-Item -ItemType Directory -Force $LogDir | Out-Null

function Get-OrxBin {
    $candidate = Join-Path $HOME ".cargo\bin\orx.exe"
    if (Test-Path $candidate) { return $candidate }
    $command = Get-Command orx.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw "Не найден orx.exe."
}

function Get-NodeBin {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $command = Get-Command node -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw "Не найден Node.js."
}

function Get-TunnelBin {
    $preferred = Join-Path $RepoRoot "runtime\openai-tunnel-client\v0.0.14\tunnel-client.exe"
    if (Test-Path $preferred) { return $preferred }
    $candidate = Get-ChildItem (Join-Path $RepoRoot "runtime") -Filter "tunnel-client.exe" -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
    throw "Не найден tunnel-client.exe."
}

function Test-Http {
    param([Parameter(Mandatory)][string]$Url)
    try {
        $response = Invoke-RestMethod $Url -TimeoutSec 2
        if ($null -ne $response.ok) { return [bool]$response.ok }
        return $true
    } catch {
        return $false
    }
}

function Get-TunnelState {
    try {
        $bin = Get-TunnelBin
        $raw = & $bin runtimes status $Alias --json 2>$null
        if (-not $raw) {
            return [pscustomobject]@{ Running = $false; Healthy = $false; Ready = $false }
        }
        $status = ($raw -join [Environment]::NewLine) | ConvertFrom-Json
        return [pscustomobject]@{
            Running = [bool]$status.process_running
            Healthy = [bool]$status.healthy
            Ready = [bool]$status.ready
        }
    } catch {
        return [pscustomobject]@{ Running = $false; Healthy = $false; Ready = $false }
    }
}

function Get-StackState {
    $orx = Test-Http $OpenResearchHealthUrl
    $bridge = Test-Http $BridgeHealthUrl
    $tunnel = Get-TunnelState
    return [pscustomobject]@{
        OpenResearch = $orx
        Bridge = $bridge
        Tunnel = ($tunnel.Running -and $tunnel.Healthy -and $tunnel.Ready)
        TunnelRunning = $tunnel.Running
        AllOn = ($orx -and $bridge -and $tunnel.Running -and $tunnel.Healthy -and $tunnel.Ready)
        AllOff = ((-not $orx) -and (-not $bridge) -and (-not $tunnel.Running))
    }
}

function Wait-Http {
    param([Parameter(Mandatory)][string]$Url, [int]$Seconds = 20)
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Http $Url) { return $true }
        Start-Sleep -Milliseconds 300
        [System.Windows.Forms.Application]::DoEvents()
    }
    return $false
}

function Stop-PortOwner {
    param([Parameter(Mandatory)][int]$Port)
    $pids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($processId in $pids) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}

function Save-RuntimeKey {
    param([Parameter(Mandatory)][string]$PlainText)
    if ([string]::IsNullOrWhiteSpace($PlainText)) { throw "Runtime API key пуст." }
    $secure = ConvertTo-SecureString $PlainText -AsPlainText -Force
    $encrypted = ConvertFrom-SecureString $secure
    Set-Content -LiteralPath $RuntimeKeyFile -Value $encrypted -Encoding UTF8
}

function Read-RuntimeKey {
    if (-not (Test-Path $RuntimeKeyFile)) { return $null }
    try {
        $encrypted = (Get-Content -LiteralPath $RuntimeKeyFile -Raw).Trim()
        $secure = ConvertTo-SecureString $encrypted
        $credential = [pscredential]::new("runtime", $secure)
        return $credential.GetNetworkCredential().Password
    } catch {
        return $null
    }
}

function Prompt-RuntimeKey {
    $dialog = New-Object System.Windows.Forms.Form
    $dialog.Text = "Tura — Runtime API key"
    $dialog.Size = New-Object System.Drawing.Size(520, 215)
    $dialog.StartPosition = "CenterParent"
    $dialog.FormBorderStyle = "FixedDialog"
    $dialog.MaximizeBox = $false
    $dialog.MinimizeBox = $false

    $label = New-Object System.Windows.Forms.Label
    $label.Location = New-Object System.Drawing.Point(18, 18)
    $label.Size = New-Object System.Drawing.Size(470, 58)
    $label.Text = "Туннель сейчас не запущен. Вставь Runtime API key OpenAI." + [Environment]::NewLine + "Ключ будет сохранён только на этом ПК в зашифрованном виде Windows DPAPI."
    $dialog.Controls.Add($label)

    $box = New-Object System.Windows.Forms.TextBox
    $box.Location = New-Object System.Drawing.Point(20, 82)
    $box.Size = New-Object System.Drawing.Size(462, 26)
    $box.UseSystemPasswordChar = $true
    $dialog.Controls.Add($box)

    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = "Сохранить"
    $ok.Location = New-Object System.Drawing.Point(300, 125)
    $ok.Size = New-Object System.Drawing.Size(88, 30)
    $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $dialog.AcceptButton = $ok
    $dialog.Controls.Add($ok)

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = "Отмена"
    $cancel.Location = New-Object System.Drawing.Point(394, 125)
    $cancel.Size = New-Object System.Drawing.Size(88, 30)
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $dialog.CancelButton = $cancel
    $dialog.Controls.Add($cancel)

    $result = $dialog.ShowDialog()
    if ($result -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
    return $box.Text
}

function Ensure-RuntimeKey {
    $key = Read-RuntimeKey
    if ($key) { return $key }

    $userEnv = [Environment]::GetEnvironmentVariable("CONTROL_PLANE_API_KEY", "User")
    if ($userEnv) {
        Save-RuntimeKey $userEnv
        return $userEnv
    }

    $processEnv = [Environment]::GetEnvironmentVariable("CONTROL_PLANE_API_KEY", "Process")
    if ($processEnv) {
        Save-RuntimeKey $processEnv
        return $processEnv
    }

    $entered = Prompt-RuntimeKey
    if (-not $entered) { return $null }
    Save-RuntimeKey $entered
    return $entered
}

function Start-OpenResearch {
    if (Test-Http $OpenResearchHealthUrl) { return }
    $orx = Get-OrxBin
    $params = @{
        FilePath = $orx
        ArgumentList = @("up", "--no-browser")
        WindowStyle = "Hidden"
        WorkingDirectory = $HOME
        RedirectStandardOutput = (Join-Path $LogDir "openresearch.stdout.log")
        RedirectStandardError = (Join-Path $LogDir "openresearch.stderr.log")
    }
    Start-Process @params | Out-Null
    if (-not (Wait-Http $OpenResearchHealthUrl 25)) {
        throw "OpenResearch не поднялся на порту 4791. См. журнал в $LogDir"
    }
}

function Start-Bridge {
    if (Test-Http $BridgeHealthUrl) { return }

    $dist = Join-Path $RepoRoot "dist\index.js"
    if (-not (Test-Path $dist)) {
        $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if ($npmCommand) { $npm = $npmCommand.Source } else { $npm = (Get-Command npm -ErrorAction Stop).Source }
        $buildParams = @{
            FilePath = $npm
            ArgumentList = @("run", "build")
            WorkingDirectory = $RepoRoot
            WindowStyle = "Hidden"
            PassThru = $true
            Wait = $true
        }
        $build = Start-Process @buildParams
        if ($build.ExitCode -ne 0) { throw "Не удалось собрать Tura bridge." }
    }

    $node = Get-NodeBin
    $params = @{
        FilePath = $node
        ArgumentList = @("dist/index.js")
        WorkingDirectory = $RepoRoot
        WindowStyle = "Hidden"
        RedirectStandardOutput = (Join-Path $LogDir "tura.stdout.log")
        RedirectStandardError = (Join-Path $LogDir "tura.stderr.log")
    }
    Start-Process @params | Out-Null
    if (-not (Wait-Http $BridgeHealthUrl 20)) {
        throw "Tura bridge не поднялся на порту 8787. См. журнал в $LogDir"
    }
}

function Start-Tunnel {
    $state = Get-TunnelState
    if ($state.Running -and $state.Healthy -and $state.Ready) { return }

    $key = Ensure-RuntimeKey
    if (-not $key) { throw "Для запуска туннеля нужен Runtime API key." }
    if (-not (Test-Path $TunnelIdFile)) { throw "Не найден файл tunnel id: $TunnelIdFile" }

    $tunnelId = (Get-Content -LiteralPath $TunnelIdFile -Raw).Trim()
    if (-not $tunnelId) { throw "Файл tunnel id пуст." }

    $bin = Get-TunnelBin
    $old = $env:CONTROL_PLANE_API_KEY
    try {
        $env:CONTROL_PLANE_API_KEY = $key
        $raw = & $bin runtimes connect --alias $Alias --tunnel-id $tunnelId --profile $Alias --profile-dir $ProfileDir --mcp-server-url $McpUrl --runtime-api-key "env:CONTROL_PLANE_API_KEY" --json 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw ("Не удалось запустить OpenAI Tunnel:" + [Environment]::NewLine + ($raw -join [Environment]::NewLine))
        }
    } finally {
        if ($null -eq $old) {
            Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
        } else {
            $env:CONTROL_PLANE_API_KEY = $old
        }
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    while ([DateTime]::UtcNow -lt $deadline) {
        $state = Get-TunnelState
        if ($state.Running -and $state.Healthy -and $state.Ready) { return }
        Start-Sleep -Milliseconds 500
        [System.Windows.Forms.Application]::DoEvents()
    }
    throw "Туннель запущен, но не перешёл в состояние ready."
}

function Start-Stack {
    Start-OpenResearch
    Start-Bridge
    Start-Tunnel
}

function Stop-Tunnel {
    $state = Get-TunnelState
    if (-not $state.Running) { return }

    $bin = Get-TunnelBin
    $raw = & $bin runtimes stop $Alias --json 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ("Не удалось остановить OpenAI Tunnel:" + [Environment]::NewLine + ($raw -join [Environment]::NewLine))
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while ([DateTime]::UtcNow -lt $deadline) {
        $state = Get-TunnelState
        if (-not $state.Running) { return }
        Start-Sleep -Milliseconds 300
        [System.Windows.Forms.Application]::DoEvents()
    }

    throw "OpenAI Tunnel не завершился за 15 секунд."
}

function Stop-Stack {
    $tunnelError = $null
    try {
        Stop-Tunnel
    } catch {
        $tunnelError = $_.Exception.Message
    }

    Stop-PortOwner 8787
    Stop-PortOwner 4791

    if ($tunnelError) {
        throw $tunnelError
    }
}

function New-StatusIcon {
    param([Parameter(Mandatory)][System.Drawing.Color]$Color)

    $bitmap = New-Object System.Drawing.Bitmap(32, 32)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70, 0, 0, 0))
    $brush = New-Object System.Drawing.SolidBrush($Color)
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 2)

    try {
        $graphics.FillEllipse($shadowBrush, 4, 5, 24, 24)
        $graphics.FillEllipse($brush, 3, 3, 24, 24)
        $graphics.DrawEllipse($borderPen, 3, 3, 24, 24)

        $handle = $bitmap.GetHicon()
        try {
            return ([System.Drawing.Icon]::FromHandle($handle)).Clone()
        } finally {
            [void][TuraNativeMethods]::DestroyIcon($handle)
        }
    } finally {
        $borderPen.Dispose()
        $brush.Dispose()
        $shadowBrush.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Get-StatusText {
    param($State)

    if ($State.OpenResearch) { $orx = "OR: OK" } else { $orx = "OR: OFF" }
    if ($State.Bridge) { $bridge = "Tura: OK" } else { $bridge = "Tura: OFF" }
    if ($State.Tunnel) { $tunnel = "Tunnel: OK" } elseif ($State.TunnelRunning) { $tunnel = "Tunnel: WAIT" } else { $tunnel = "Tunnel: OFF" }

    if ($State.AllOn) {
        return "Tura ВКЛ | $orx | $bridge | $tunnel"
    }
    if ($State.AllOff) {
        return "Tura ВЫКЛ | $orx | $bridge | $tunnel"
    }
    return "Tura НЕПОЛНОЕ СОСТОЯНИЕ | $orx | $bridge | $tunnel"
}

function Show-StatusBalloon {
    param($State)

    if ($State.AllOn) {
        $title = "Tura — ВКЛЮЧЕНО"
    } elseif ($State.AllOff) {
        $title = "Tura — ВЫКЛЮЧЕНО"
    } else {
        $title = "Tura — неполное состояние"
    }

    $orx = if ($State.OpenResearch) { "OpenResearch: работает" } else { "OpenResearch: выключен" }
    $bridge = if ($State.Bridge) { "Tura: работает" } else { "Tura: выключена" }
    $tunnel = if ($State.Tunnel) { "Tunnel: ready" } elseif ($State.TunnelRunning) { "Tunnel: запущен, но не ready" } else { "Tunnel: выключен" }

    $notify.BalloonTipTitle = $title
    $notify.BalloonTipText = $orx + [Environment]::NewLine + $bridge + [Environment]::NewLine + $tunnel
    $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $notify.ShowBalloonTip(3500)
}

$greenIcon = New-StatusIcon ([System.Drawing.Color]::LimeGreen)
$redIcon = New-StatusIcon ([System.Drawing.Color]::Red)
$yellowIcon = New-StatusIcon ([System.Drawing.Color]::Gold)

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menuOn = $menu.Items.Add("Включить")
$menuOff = $menu.Items.Add("Выключить")
$menuRestart = $menu.Items.Add("Перезапустить")
[void]$menu.Items.Add("-")
$menuStatus = $menu.Items.Add("Статус")
$menuLogs = $menu.Items.Add("Открыть логи")
$menuFolder = $menu.Items.Add("Открыть папку Tura")
[void]$menu.Items.Add("-")
$menuExit = $menu.Items.Add("Выход")

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Visible = $true
$notify.ContextMenuStrip = $menu
$notify.Icon = $yellowIcon
$notify.Text = "Tura — проверка состояния"

$script:Busy = $false
$script:CurrentState = $null
$script:ExitRequested = $false

function Update-Tray {
    if ($script:Busy) {
        $notify.Icon = $yellowIcon
        $notify.Text = "Tura — выполняется операция"
        $menuOn.Enabled = $false
        $menuOff.Enabled = $false
        $menuRestart.Enabled = $false
        return
    }

    $state = Get-StackState
    $script:CurrentState = $state

    if ($state.AllOn) {
        $notify.Icon = $greenIcon
    } elseif ($state.AllOff) {
        $notify.Icon = $redIcon
    } else {
        $notify.Icon = $yellowIcon
    }

    $text = Get-StatusText $state
    if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
    $notify.Text = $text

    $menuOn.Enabled = -not $state.AllOn
    $menuOff.Enabled = -not $state.AllOff
    $menuRestart.Enabled = $true
}

function Invoke-StackAction {
    param([Parameter(Mandatory)][ValidateSet("start", "stop", "restart")][string]$Action)

    if ($script:Busy) { return }
    $script:Busy = $true
    Update-Tray
    [System.Windows.Forms.Application]::DoEvents()

    try {
        switch ($Action) {
            "start" {
                Start-Stack
            }
            "stop" {
                Stop-Stack
            }
            "restart" {
                Stop-Stack
                Start-Stack
            }
        }
    } catch {
        $notify.BalloonTipTitle = "Tura — ошибка"
        $notify.BalloonTipText = $_.Exception.Message
        $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Error
        $notify.ShowBalloonTip(6000)
    } finally {
        $script:Busy = $false
        Update-Tray
    }
}

$menuOn.Add_Click({ Invoke-StackAction "start" })
$menuOff.Add_Click({ Invoke-StackAction "stop" })
$menuRestart.Add_Click({ Invoke-StackAction "restart" })
$menuStatus.Add_Click({
    Update-Tray
    Show-StatusBalloon $script:CurrentState
})
$menuLogs.Add_Click({
    New-Item -ItemType Directory -Force $LogDir | Out-Null
    Start-Process explorer.exe $LogDir
})
$menuFolder.Add_Click({
    Start-Process explorer.exe $RepoRoot
})
$menuExit.Add_Click({
    $script:ExitRequested = $true
    [System.Windows.Forms.Application]::Exit()
})

$notify.Add_MouseClick({
    param($sender, $eventArgs)

    if ($eventArgs.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
    if ($script:Busy) { return }

    Update-Tray
    if ($script:CurrentState.AllOn) {
        Invoke-StackAction "stop"
    } else {
        Invoke-StackAction "start"
    }
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2500
$timer.Add_Tick({ Update-Tray })
$timer.Start()

try {
    Update-Tray
    [System.Windows.Forms.Application]::Run()
} finally {
    $timer.Stop()
    $timer.Dispose()
    $notify.Visible = $false
    $notify.Dispose()
    $menu.Dispose()
    $greenIcon.Dispose()
    $redIcon.Dispose()
    $yellowIcon.Dispose()
}
