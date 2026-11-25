param([string]$ArchivoControl, [string]$DatosDir, [string]$ExpedientesDir, [string]$ChromePath, [int]$Puerto = 3080)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$shell = New-Object -ComObject WScript.Shell
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
foreach ($entry in @(
    @{ Name = 'Iniciar bot CODESVI'; Script = 'iniciar-windows.ps1'; Description = 'Iniciar el bot y abrir el dashboard de CODESVI' },
    @{ Name = 'Detener bot CODESVI'; Script = 'detener-windows.ps1'; Description = 'Apagar ordenadamente el bot de CODESVI' }
)) {
    $shortcut = $shell.CreateShortcut((Join-Path $desktop ($entry.Name + '.lnk')))
    $shortcut.TargetPath = $powershellPath
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot $entry.Script) + '"'
    if ($entry.Script -eq 'iniciar-windows.ps1') {
        $shortcut.Arguments += ' -DatosDir "' + $DatosDir + '" -ExpedientesDir "' + $ExpedientesDir + '" -ChromePath "' + $ChromePath + '" -Puerto ' + $Puerto
    } else { $shortcut.Arguments += ' -ArchivoControl "' + $ArchivoControl + '"' }
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.WindowStyle = 7
    $shortcut.Description = $entry.Description
    $shortcut.Save()
}
Write-Host 'Accesos Iniciar bot CODESVI y Detener bot CODESVI preparados en el Escritorio.'
