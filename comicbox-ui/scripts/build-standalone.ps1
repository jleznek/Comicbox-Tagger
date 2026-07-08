$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
$distPath = Join-Path $projectRoot 'dist'
$backendPath = Join-Path $projectRoot 'backend'
$pyiWorkPath = Join-Path $env:TEMP 'comicboxtagstudio-pyinstaller'
$releaseFolder = Join-Path $projectRoot 'release\ComicboxTagStudio'

function Remove-WithRetry {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [int]$Attempts = 3
  )

  if (-not (Test-Path $Path)) {
    return
  }

  for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
    try {
      Remove-Item $Path -Recurse -Force
      return
    }
    catch {
      if ($attempt -eq $Attempts) {
        throw
      }
      Start-Sleep -Milliseconds 400
    }
  }
}

if (-not (Test-Path '.\.venv\Scripts\python.exe')) {
  throw "Missing .venv python at .venv\Scripts\python.exe. Create the venv first."
}

npm run build
if ($LASTEXITCODE -ne 0) {
  throw "Frontend build failed."
}

.\.venv\Scripts\python -m pip install pyinstaller
if ($LASTEXITCODE -ne 0) {
  throw "Failed to install PyInstaller."
}

# Release dir can stay locked by a running packaged app; stop it before building.
Get-Process -Name 'ComicboxTagStudio' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-WithRetry -Path $releaseFolder

.\.venv\Scripts\pyinstaller `
  --noconfirm `
  --clean `
  --name ComicboxTagStudio `
  --onedir `
  --distpath release `
  --workpath "$pyiWorkPath" `
  --specpath . `
  --add-data "$distPath;dist" `
  --add-data "$backendPath;backend" `
  --hidden-import uvicorn.logging `
  --hidden-import uvicorn.loops.auto `
  --hidden-import uvicorn.protocols.http.auto `
  --collect-all comicbox `
  --collect-all fastapi `
  --collect-all starlette `
  --collect-all pydantic `
  --collect-all anyio `
  standalone_launcher.py
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller build failed."
}

if (Test-Path $pyiWorkPath) {
  Remove-Item $pyiWorkPath -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Standalone app created at: $projectRoot\release\ComicboxTagStudio\ComicboxTagStudio.exe"
