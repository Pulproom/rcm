$ErrorActionPreference = 'Stop'
$data = if ($env:RCM_DATA_DIR) { [IO.Path]::GetFullPath($env:RCM_DATA_DIR) } else { Join-Path (Split-Path $PSScriptRoot -Parent) 'RCM-user-data' }
$runtime = Join-Path $data 'runtime.json'
if (!(Test-Path -LiteralPath $runtime)) { Write-Host 'RCM is not running.'; exit }
$saved = Get-Content -LiteralPath $runtime -Raw | ConvertFrom-Json
$server = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
if ($server) {
  $started = ([DateTimeOffset]$server.StartTime).ToUnixTimeMilliseconds()
  if ($server.Path -ne (Join-Path $PSScriptRoot 'runtime/node.exe') -or [Math]::Abs($started - $saved.startedAt) -gt 30000) { throw 'Process identity changed. No process was stopped.' }
  Stop-Process -Id $saved.pid
}
Remove-Item -LiteralPath $runtime
Write-Host 'RCM stopped. User data was preserved.'
