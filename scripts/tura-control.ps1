Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

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

function Stop-Stack {
    Stop-PortOwner 8787
    Stop-PortOwner 4791
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Tura Control"
$form.Size = New-Object System.Drawing.Size(430, 330)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false

$title = New-Object System.Windows.Forms.Label
$title.Text = "Tura / OpenResearch"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(22, 18)
$title.Size = New-Object System.Drawing.Size(370, 34)
$form.Controls.Add($title)

$details = New-Object System.Windows.Forms.Label
$details.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$details.Location = New-Object System.Drawing.Point(25, 62)
$details.Size = New-Object System.Drawing.Size(365, 76)
$form.Controls.Add($details)

$button = New-Object System.Windows.Forms.Button
$button.Location = New-Object System.Drawing.Point(25, 148)
$button.Size = New-Object System.Drawing.Size(365, 88)
$button.FlatStyle = "Flat"
$button.FlatAppearance.BorderSize = 0
$button.ForeColor = [System.Drawing.Color]::White
$button.Font = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($button)

$note = New-Object System.Windows.Forms.Label
$note.Text = "Выключение останавливает OpenResearch и Tura." + [Environment]::NewLine + "Туннель остаётся тихо в фоне для быстрого повторного включения."
$note.Font = New-Object System.Drawing.Font("Segoe UI", 8.5)
$note.ForeColor = [System.Drawing.Color]::DimGray
$note.Location = New-Object System.Drawing.Point(25, 248)
$note.Size = New-Object System.Drawing.Size(365, 42)
$form.Controls.Add($note)

$script:Busy = $false
$script:CurrentState = $null

function Update-Ui {
    if ($script:Busy) { return }
    $state = Get-StackState
    $script:CurrentState = $state

    if ($state.OpenResearch) { $orxText = "● OpenResearch: работает" } else { $orxText = "○ OpenResearch: выключен" }
    if ($state.Bridge) { $bridgeText = "● Tura: работает" } else { $bridgeText = "○ Tura: выключена" }
    if ($state.Tunnel) { $tunnelText = "● Туннель: ready" } elseif ($state.TunnelRunning) { $tunnelText = "◐ Туннель: не готов" } else { $tunnelText = "○ Туннель: выключен" }
    $details.Text = $orxText + [Environment]::NewLine + $bridgeText + [Environment]::NewLine + $tunnelText

    if ($state.AllOn) {
        $button.BackColor = [System.Drawing.Color]::SeaGreen
        $button.Text = "ВКЛЮЧЕНО" + [Environment]::NewLine + "Нажать, чтобы выключить"
    } else {
        $button.BackColor = [System.Drawing.Color]::Firebrick
        $button.Text = "ВЫКЛЮЧЕНО" + [Environment]::NewLine + "Нажать, чтобы включить"
    }
}

$button.Add_Click({
    if ($script:Busy) { return }
    $script:Busy = $true
    $button.Enabled = $false
    try {
        if ($script:CurrentState -and $script:CurrentState.AllOn) {
            $button.Text = "Выключаю..."
            [System.Windows.Forms.Application]::DoEvents()
            Stop-Stack
        } else {
            $button.Text = "Включаю..."
            [System.Windows.Forms.Application]::DoEvents()
            Start-Stack
        }
    } catch {
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Tura Control", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    } finally {
        $script:Busy = $false
        $button.Enabled = $true
        Update-Ui
    }
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2500
$timer.Add_Tick({ Update-Ui })
$timer.Start()

$form.Add_Shown({ Update-Ui })
$form.Add_FormClosed({ $timer.Stop(); $timer.Dispose() })

[void]$form.ShowDialog()
