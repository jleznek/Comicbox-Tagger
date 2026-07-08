$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$comicboxExe = Join-Path $projectRoot '.venv\Scripts\comicbox.exe'

if (-not (Test-Path $comicboxExe)) {
  throw "Comicbox executable not found at $comicboxExe. Create the project venv and install backend requirements first."
}

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$env:NO_COLOR = '1'

& $comicboxExe @args
exit $LASTEXITCODE