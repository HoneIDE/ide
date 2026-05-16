# Windows equivalent of setup.sh -- creates a temp project with realistic git
# state, launches IDE with dual geisterhand (baked-in 7676 + external 7677),
# writes .test-state file for scenarios + teardown.
#
# SHIP-V1-GAPS.md followup §5: agentic test setup for Windows.

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$HoneIdeDir = (Resolve-Path "$ScriptDir\..\..").Path
$BakedInPort = 7676
$ExternalPort = 7677
# [DateTimeOffset] avoids the locale-fragile `[double]::Parse((Get-Date -UFormat %s))` --
# de-DE / fr-FR / etc. use `,` as decimal separator and Parse(en-US) would throw.
$Stamp = [DateTimeOffset]::Now.ToUnixTimeSeconds()
$TmpDir = Join-Path $env:TEMP "hone-agentic-$Stamp"

Write-Host '=== Hone Agentic Test Setup ==='
Write-Host "Creating temp project at: $TmpDir"

# Copy seed files
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null
Copy-Item -Recurse "$ScriptDir\setup\seed-files\*" $TmpDir -Force
$gitignore = "$ScriptDir\setup\seed-files\.gitignore"
if (Test-Path $gitignore) { Copy-Item $gitignore $TmpDir -Force }

# Init git with realistic mixed state
Push-Location $TmpDir
try {
  & git init -q
  & git add .
  & git commit -q -m 'Initial commit'

  # Mixed git state for testing. `-Encoding utf8` is critical here: PowerShell
  # 5.1 defaults `Add-Content`/`Set-Content` to UTF-16 LE with BOM, which on
  # a UTF-8 seed file would flip the encoding for the whole file -- git would
  # then show a massive multi-line diff instead of the intended single-line
  # change, breaking the scenario assumptions.
  Add-Content -Path 'src\main.ts' -Value '// modified line added for testing' -Encoding utf8
  Set-Content -Path 'src\new-feature.ts' -Value 'export const NEW_FEATURE = true;' -Encoding utf8
  Add-Content -Path 'src\utils.ts' -Value '// staged change for review' -Encoding utf8
  & git add 'src\utils.ts'

  Write-Host 'Git state created:'
  Write-Host '  Modified:  src/main.ts'
  Write-Host '  Staged:    src/utils.ts'
  Write-Host '  Untracked: src/new-feature.ts'
} finally {
  Pop-Location
}

# Results directory for this run
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$ResultsDir = "$ScriptDir\results\$Timestamp"
New-Item -ItemType Directory -Force -Path "$ResultsDir\screenshots" | Out-Null

# Kill any existing hone-ide and geisterhand processes
Get-Process -Name 'hone-ide' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name 'geisterhand' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# Verify IDE binary
$IdeBin = "$HoneIdeDir\hone-ide.exe"
if (-not (Test-Path $IdeBin)) {
  Write-Error "IDE binary not found at $IdeBin. Build it with --enable-geisterhand."
  exit 1
}

# Launch IDE (baked-in geisterhand on $BakedInPort)
Write-Host ''
Write-Host "Launching IDE (baked-in API on port $BakedInPort)..."
$IdeProc = Start-Process -FilePath $IdeBin -ArgumentList $TmpDir -PassThru -WindowStyle Hidden
$IdePid = $IdeProc.Id

# Wait for baked-in API
Write-Host 'Waiting for baked-in API...'
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$BakedInPort/health" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
    if ($r.StatusCode -eq 200) {
      Write-Host "Baked-in API ready on port $BakedInPort"
      $ok = $true
      break
    }
  } catch {}
  Start-Sleep -Milliseconds 500
}
if (-not $ok) {
  Write-Error 'Baked-in API did not start within 15 seconds. Was the binary built with --enable-geisterhand?'
  Stop-Process -Id $IdePid -Force -ErrorAction SilentlyContinue
  exit 1
}

# Launch external geisterhand CLI server
Write-Host "Launching external geisterhand server on port $ExternalPort..."
$ExternalPid = ''
try {
  $ExternalProc = Start-Process -FilePath 'geisterhand' -ArgumentList @('server', '--port', $ExternalPort) -PassThru -WindowStyle Hidden -ErrorAction Stop
  $ExternalPid = $ExternalProc.Id
  $extOk = $false
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$ExternalPort/health" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
      if ($r.StatusCode -eq 200) {
        Write-Host "External CLI server ready on port $ExternalPort"
        $extOk = $true
        break
      }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  if (-not $extOk) {
    Write-Warning 'External CLI server did not start (non-fatal, baked-in still works)'
    $ExternalPid = ''
  }
} catch {
  Write-Warning "geisterhand CLI not found in PATH -- external server skipped"
  $ExternalPid = ''
}

# Wait a bit more for IDE to fully render
Start-Sleep -Seconds 2

# Write state file
$state = @"
IDE_PID=$IdePid
EXTERNAL_PID=$ExternalPid
PROJECT_DIR=$TmpDir
RESULTS_DIR=$ResultsDir
TIMESTAMP=$Timestamp
BAKED_IN_PORT=$BakedInPort
EXTERNAL_PORT=$ExternalPort
"@
Set-Content -Path "$ScriptDir\.test-state" -Value $state -Encoding utf8

Write-Host ''
Write-Host '=== Setup Complete ==='
Write-Host "  Project:     $TmpDir"
Write-Host "  Results:     $ResultsDir"
Write-Host "  IDE:         PID $IdePid (baked-in API on :$BakedInPort)"
Write-Host "  External:    PID $ExternalPid (CLI server on :$ExternalPort)"
Write-Host ''
Write-Host 'See tests/agentic/API.md for endpoint routing guide.'
Write-Host "State saved to $ScriptDir\.test-state"
