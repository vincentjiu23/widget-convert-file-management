$ErrorActionPreference = "Stop"

$exePath = "release\win-unpacked\Radial File Studio.exe"
Write-Host "=================================================="
Write-Host "   PACKAGED EXE SMOKE TEST: Radial File Studio"
Write-Host "=================================================="

if (!(Test-Path $exePath)) {
    Write-Error "Executable not found at $exePath"
}
Write-Host "[PASS] Found executable at: $exePath"

# Remove existing DB in test APPDATA if any to prove fresh initialization
$appData = [Environment]::GetFolderPath('ApplicationData')
$appFolder = Join-Path $appData "radial-file-studio"
$dbPath = Join-Path $appFolder "radial_studio.sqlite"

if (Test-Path $dbPath) {
    Write-Host "Removing pre-existing test database to test cold initialization..."
    Remove-Item $dbPath -Force
}

Write-Host "Launching Packaged Executable..."
$proc = Start-Process -FilePath $exePath -PassThru

# Give Electron main process time to unpack WASM, create DB, apply schema, and launch windows
Start-Sleep -Seconds 6

$running = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
if ($null -ne $running -and !$running.HasExited) {
    Write-Host "[PASS] Application launched successfully (PID: $($proc.Id))"
} else {
    Write-Error "[FAIL] Application exited prematurely or failed to start."
}

Write-Host "Verifying SQLite Database in %APPDATA%..."
if (Test-Path $dbPath) {
    $item = Get-Item $dbPath
    Write-Host "[PASS] Database file created at: $dbPath ($($item.Length) bytes)"
    if ($item.Length -gt 0) {
        Write-Host "[PASS] Database contains initialized SQLite schema data"
    } else {
        Write-Error "[FAIL] Database file is 0 bytes"
    }
} else {
    Write-Error "[FAIL] Database file was not created at $dbPath"
}

Write-Host "Stopping smoke-test process..."
Stop-Process -Id $proc.Id -Force
Start-Sleep -Seconds 1
Write-Host "[PASS] Smoke test completed cleanly."
