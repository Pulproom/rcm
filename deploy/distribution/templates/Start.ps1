$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = Join-Path $root 'runtime/node.exe'
$launch = Join-Path $root 'launch.mjs'
$data = if ($env:RCM_DATA_DIR) { [IO.Path]::GetFullPath($env:RCM_DATA_DIR) } else { Join-Path (Split-Path $root -Parent) 'RCM-user-data' }
New-Item -ItemType Directory -Path $data -Force | Out-Null
$started = Start-Process -FilePath $node -ArgumentList ('"' + $launch + '"') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'server.log') -RedirectStandardError (Join-Path $data 'server-error.log') -PassThru
for ($i = 0; $i -lt 50; $i++) {
  Start-Sleep -Milliseconds 200
  $started.Refresh()
  if ($started.HasExited) { throw "RCM did not start. Check $data/server-error.log" }
  $connectionFile = Join-Path $data 'connection.json'
  if (Test-Path -LiteralPath $connectionFile) {
    $connection = Get-Content -LiteralPath $connectionFile -Raw | ConvertFrom-Json
    try {
      $health = Invoke-RestMethod -Uri ($connection.serverUrl + '/v1/health') -TimeoutSec 1
      if ($health) { Write-Host "RCM ready: $($connection.serverUrl). Connection settings: $connectionFile"; exit }
    } catch {}
  }
}
throw "RCM startup timed out. Check $data/server-error.log"
