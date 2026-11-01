param(
    [string]$NodePath = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dist = [IO.Path]::GetFullPath((Join-Path $root 'dist'))
$archive = Join-Path $dist 'valorant-wl-counter-windows.zip'
if (-not $NodePath) { $NodePath = Join-Path $root 'runtime\node.exe' }
$NodePath = [IO.Path]::GetFullPath($NodePath)
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw 'Node.js oficial nao encontrado. Coloque a versao 24.22.1 x64 em runtime\node.exe ou passe -NodePath.'
}
# Official SHA256 from https://nodejs.org/dist/v24.22.1/SHASUMS256.txt.
$expectedHash = 'd702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5'
$actualHash = (Get-FileHash -LiteralPath $NodePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) { throw 'O Node.exe nao corresponde ao SHA256 oficial da versao 24.22.1 Windows x64.' }
if ((Test-Path -LiteralPath $archive) -and -not $Force) { throw 'O ZIP ja existe. Para substituir, use -Force.' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'Compilador C# do .NET Framework nao encontrado.' }
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$tempDir = [IO.Path]::GetFullPath((Join-Path $dist ('staging-' + [Guid]::NewGuid().ToString('N'))))
if (-not $tempDir.StartsWith($dist + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Pasta temporaria invalida.' }
$package = Join-Path $tempDir 'valorant-wl-counter'
New-Item -ItemType Directory -Path $package -Force | Out-Null
try {
    # Explicit allowlist: never copy data, local credentials, logs, or Git history.
    foreach ($name in @('src','public','test','tools','docs','licenses','README.md','LICENSE','LEIA-ME-PRIMEIRO.txt','package.json','iniciar.bat','instalar.bat','parar.bat')) {
        Copy-Item -LiteralPath (Join-Path $root $name) -Destination $package -Recurse
    }
    $runtimeDir = Join-Path $package 'runtime'
    New-Item -ItemType Directory -Path $runtimeDir | Out-Null
    Copy-Item -LiteralPath $NodePath -Destination (Join-Path $runtimeDir 'node.exe')
    Copy-Item -LiteralPath (Join-Path $root 'licenses\NODEJS-LICENSE.txt') -Destination (Join-Path $runtimeDir 'LICENSE.txt')
    & $compiler /nologo /target:winexe '/reference:System.Windows.Forms.dll' ('/out:' + (Join-Path $package 'Valorant W-L.exe')) (Join-Path $root 'tools\Launcher.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o lancador.' }
    $check = Start-Process -FilePath (Join-Path $package 'Valorant W-L.exe') -ArgumentList '--check' -WindowStyle Hidden -Wait -PassThru
    if ($check.ExitCode -ne 0) { throw 'O lancador do pacote nao passou na verificacao.' }
    if ($Force -and (Test-Path -LiteralPath $archive)) { Remove-Item -LiteralPath $archive -Force }
    Compress-Archive -LiteralPath $package -DestinationPath $archive -CompressionLevel Optimal
    Write-Host "Pacote criado: $archive"
} finally {
    if (Test-Path -LiteralPath $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force }
}
