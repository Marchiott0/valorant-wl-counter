param([switch]$CheckOnly, [switch]$Stop, [switch]$NoBrowser, [switch]$Gui)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$serverPath = Join-Path $projectRoot 'src\server.mjs'
$baseUrl = 'http://127.0.0.1:3791'

function Show-Problem([string]$message) {
    Write-Host $message -ForegroundColor Red
    if ($Gui) {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show($message, 'Valorant W/L Counter', 'OK', 'Error')
    }
}

function Get-CounterHealth {
    try { return Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 2 -UseBasicParsing }
    catch { return $null }
}

function Test-OwnInstance($health) {
    return ($null -ne $health -and $health.app -eq 'valorant-wl-counter' -and $health.ok -eq $true -and
        [string]::Equals([string]$health.projectRoot, $projectRoot, [StringComparison]::OrdinalIgnoreCase))
}

try {
    if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
        throw 'O arquivo src\server.mjs esta ausente. Mantenha todos os arquivos na mesma pasta do programa.'
    }

    $nodeCandidates = @((Join-Path $projectRoot 'runtime\node.exe'))
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $nodeCandidates += $nodeCommand.Source }
    $nodePath = $null
    foreach ($candidate in $nodeCandidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $candidateVersion = (& $candidate --version 2>$null | Out-String).Trim()
            if ($candidateVersion -match '^v(\d+)\.' -and [int]$Matches[1] -ge 22) {
                $nodePath = $candidate
                break
            }
        }
    }
    if (-not $nodePath) {
        throw 'Node.js 22 ou superior nao encontrado. Restaure runtime\node.exe ou instale a versao LTS em https://nodejs.org e tente novamente.'
    }
    if ($CheckOnly) {
        & $nodePath (Join-Path $projectRoot 'tools\check.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'A verificacao dos arquivos encontrou problemas.' }
        Write-Host "Node.js encontrado: $candidateVersion"
        Write-Host 'Programa pronto para iniciar.'
        exit 0
    }

    $health = Get-CounterHealth
    if ($Stop) {
        if (-not (Test-OwnInstance $health)) {
            if ($null -eq $health) { Write-Host 'O programa nao esta em execucao.'; exit 0 }
            throw 'A porta 3791 pertence a outra instancia ou aplicativo. Nenhum processo foi encerrado.'
        }
        $appProcessId = [int]$health.pid
        $appProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $appProcessId"
        if (-not $appProcess -or $appProcess.Name -ne 'node.exe' -or
            $appProcess.CommandLine.IndexOf($serverPath, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
            throw 'Nao foi possivel confirmar o processo do programa. Nenhum processo foi encerrado.'
        }
        Stop-Process -Id $appProcessId
        Write-Host 'Valorant W/L Counter encerrado. O overlay para de atualizar ate voce iniciar novamente.'
        exit 0
    }

    if ($null -ne $health -and -not (Test-OwnInstance $health)) {
        throw 'A porta 3791 esta ocupada por outro programa ou por uma copia em outra pasta. Feche essa instancia antes de iniciar.'
    }

    if (-not (Test-OwnInstance $health)) {
        $dataPath = Join-Path $projectRoot 'data'
        [void](New-Item -ItemType Directory -Path $dataPath -Force)
        $process = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $serverPath + '"')) `
            -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $dataPath 'server.log') `
            -RedirectStandardError (Join-Path $dataPath 'server-error.log')
        $deadline = [DateTime]::UtcNow.AddSeconds(20)
        do {
            Start-Sleep -Milliseconds 400
            $health = Get-CounterHealth
            $process.Refresh()
            if ($process.HasExited) {
                throw 'O servidor nao iniciou. Verifique se a porta 3791 esta livre. Detalhes locais: data\server-error.log.'
            }
        } while (-not (Test-OwnInstance $health) -and [DateTime]::UtcNow -lt $deadline)
        if (-not (Test-OwnInstance $health)) {
            throw 'O servidor nao respondeu a tempo. Verifique data\server-error.log e tente novamente.'
        }
    }

    if (-not $NoBrowser) { Start-Process $baseUrl -WindowStyle Hidden }
    Write-Host "Painel: $baseUrl"
    Write-Host "Overlay OBS: $baseUrl/overlay"
    Write-Host 'O contador continua funcionando ao fechar o navegador. Use parar.bat para encerra-lo.'
    exit 0
} catch {
    Show-Problem $_.Exception.Message
    exit 1
}
