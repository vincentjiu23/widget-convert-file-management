$ErrorActionPreference = "Continue"

Write-Host "=== Checking for Electron / Radial processes ==="
$procs = Get-Process | Where-Object { $_.ProcessName -like '*Radial*' -or $_.ProcessName -like '*electron*' }
if ($procs) {
    $procs | Format-Table Id, ProcessName, StartTime -AutoSize
} else {
    Write-Host "No Radial or Electron processes found."
}

Write-Host ""
Write-Host "=== Checking APPDATA database ==="
$appData = [Environment]::GetFolderPath('ApplicationData')
$dbPath = Join-Path $appData "radial-file-studio\radial_studio.sqlite"
Write-Host "Expected DB path: $dbPath"

if (Test-Path $dbPath) {
    $item = Get-Item $dbPath
    Write-Host "[PASS] Database EXISTS - Size: $($item.Length) bytes - Modified: $($item.LastWriteTime)"
} else {
    Write-Host "[INFO] Database not found at expected path."
    Write-Host "Searching for any radial_studio.sqlite under AppData..."
    $found = Get-ChildItem -Path $appData -Recurse -Filter "radial_studio.sqlite" -ErrorAction SilentlyContinue
    if ($found) {
        foreach ($f in $found) {
            Write-Host "  Found: $($f.FullName) - $($f.Length) bytes"
        }
    } else {
        Write-Host "  No radial_studio.sqlite found anywhere under AppData."
    }
}
