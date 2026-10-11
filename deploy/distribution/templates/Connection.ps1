$ErrorActionPreference = 'Stop'
$data = if ($env:RCM_DATA_DIR) { [IO.Path]::GetFullPath($env:RCM_DATA_DIR) } else { Join-Path (Split-Path $PSScriptRoot -Parent) 'RCM-user-data' }
$file = Join-Path $data 'connection.json'
if (!(Test-Path -LiteralPath $file)) { throw 'Start RCM once to create connection settings.' }
$connection = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
Write-Host ('Server URL: ' + $connection.serverUrl)
Write-Host ('Token: ' + $connection.token)
Write-Host 'Copy these values into the RCM plugin. Keep the token private.'
