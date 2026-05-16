# Windows equivalent of teardown.sh -- stops IDE, external geisterhand
# server, removes temp project, deletes .test-state.

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StateFile = "$ScriptDir\.test-state"

if (-not (Test-Path $StateFile)) {
  Write-Host 'No .test-state file found - nothing to tear down'
  exit 0
}

# Parse KEY=VALUE lines from .test-state into a hashtable.
$state = @{}
Get-Content $StateFile | ForEach-Object {
  if ($_ -match '^([^=]+)=(.*)$') { $state[$matches[1]] = $matches[2] }
}

Write-Host '=== Hone Agentic Test Teardown ==='

# Kill external geisterhand CLI server
$extPid = $state['EXTERNAL_PID']
if ($extPid -and $extPid -ne '') {
  $p = Get-Process -Id $extPid -ErrorAction SilentlyContinue
  if ($p) {
    Write-Host "Killing external geisterhand server (PID $extPid)..."
    Stop-Process -Id $extPid -Force -ErrorAction SilentlyContinue
  }
}

# Kill IDE process (baked-in geisterhand dies with it)
$idePid = $state['IDE_PID']
if ($idePid -and $idePid -ne '') {
  $p = Get-Process -Id $idePid -ErrorAction SilentlyContinue
  if ($p) {
    Write-Host "Killing IDE (PID $idePid)..."
    Stop-Process -Id $idePid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }
}

# Kill any stray processes
Get-Process -Name 'hone-ide' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Clean up temp project
$proj = $state['PROJECT_DIR']
if ($proj -and (Test-Path $proj)) {
  Write-Host "Removing temp project: $proj"
  Remove-Item -Recurse -Force -Path $proj -ErrorAction SilentlyContinue
}

# Remove state file
Remove-Item -Force -Path $StateFile -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '=== Teardown Complete ==='
$resultsDir = $state['RESULTS_DIR']
if ($resultsDir -and (Test-Path $resultsDir)) {
  Write-Host "Results preserved at: $resultsDir"
}
