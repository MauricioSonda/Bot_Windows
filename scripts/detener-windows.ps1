param([string]$ArchivoControl)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:ProgramFiles 'nodejs\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { Write-Host 'Node.js no esta disponible. El bot no parece estar iniciado.'; exit 1 }
if ($ArchivoControl) { & $nodePath 'scripts/detener.js' $ArchivoControl }
else { & $nodePath 'scripts/detener.js' }
exit $LASTEXITCODE
