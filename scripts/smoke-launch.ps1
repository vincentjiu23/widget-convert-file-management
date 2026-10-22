$proc = Start-Process -FilePath ".\release\win-unpacked\Radial File Studio.exe" -PassThru
Start-Sleep -Seconds 4
$alive = -not $proc.HasExited
Write-Host "Process ID: $($proc.Id)"
Write-Host "Process Running: $alive"

if ($alive) {
    Stop-Process -Id $proc.Id -Force
    Write-Host "SUCCESS: Packaged Windows application launched without crashing and stayed active."
    exit 0
} else {
    Write-Error "FAILURE: Packaged application exited prematurely with code $($proc.ExitCode)."
    exit 1
}
