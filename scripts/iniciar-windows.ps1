param([string]$DatosDir, [string]$ExpedientesDir, [string]$ChromePath, [int]$Puerto = 0)
$ErrorActionPreference = 'Stop'
if ($DatosDir) { $env:BOT_DATA_DIR = $DatosDir }
if ($ExpedientesDir) { $env:BOT_EXPEDIENTES_DIR = $ExpedientesDir }
if ($ChromePath) { $env:BOT_CHROME_PATH = $ChromePath }
if ($Puerto -gt 0) { $env:ATENCION_API_PORT = [string]$Puerto }
Set-Location (Split-Path -Parent $PSScriptRoot)

function Find-Node {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    $candidates = @()
    if ($command) { $candidates += $command.Source }
    if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe') }
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe') }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            $major = & $candidate -p 'parseInt(process.versions.node)'
            if ($LASTEXITCODE -eq 0 -and [int]$major -ge 24) { return $candidate }
        }
    }
    return $null
}

try {
    $nodePath = Find-Node
    if (-not $nodePath) {
        if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
            throw 'Instale Node.js 24 LTS desde https://nodejs.org y vuelva a ejecutar iniciar-bot.cmd. No se encontro WinGet.'
        }
        Write-Host 'Instalando Node.js LTS. Windows puede solicitar autorizacion para instalarlo...'
        & winget.exe install --id OpenJS.NodeJS.LTS --exact --source winget --accept-source-agreements --accept-package-agreements
        $nodePath = Find-Node
        if (-not $nodePath) { throw 'No se pudo preparar Node.js 24 o superior. Instale Node.js desde https://nodejs.org y repita este comando.' }
    }
    $env:Path = (Split-Path -Parent $nodePath) + ';' + $env:Path
    & $nodePath 'scripts/iniciar.js'
    exit $LASTEXITCODE
} catch {
    Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
