$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not $env:SKIP_EXE_REBUILD) {
  Write-Host "Building standalone EXE..."
  npm run build:exe
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to build standalone EXE."
  }
} elseif (-not (Test-Path '.\\release\\ComicboxTagStudio\\ComicboxTagStudio.exe')) {
  throw "SKIP_EXE_REBUILD is set, but release\\ComicboxTagStudio\\ComicboxTagStudio.exe was not found."
}

$isccPath = $null
$iscc = Get-Command iscc -ErrorAction SilentlyContinue
if ($iscc) {
  $isccPath = $iscc.Source
}

if (-not $isccPath) {
  $candidatePaths = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\\Inno Setup 6\\ISCC.exe'),
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
    'C:\Program Files\Inno Setup 6\ISCC.exe'
  )
  foreach ($candidate in $candidatePaths) {
    if (Test-Path $candidate) {
      $isccPath = $candidate
      break
    }
  }
}

if (-not $isccPath) {
  throw "Inno Setup compiler (iscc) not found. Install Inno Setup, then rerun this script."
}

$issFile = Join-Path $projectRoot 'installer\\ComicboxTagStudio.iss'
& $isccPath $issFile
if ($LASTEXITCODE -ne 0) {
  throw "Installer build failed."
}

Write-Host "Installer created at: $projectRoot\\release\\installer\\ComicboxTagStudio-Setup.exe"
