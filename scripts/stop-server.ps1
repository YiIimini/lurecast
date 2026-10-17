$ErrorActionPreference = 'SilentlyContinue'
$found = $false
foreach ($p in ($args | ForEach-Object { [int]$_ })) { }
for ($port = 8123; $port -lt 8135; $port++) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) { continue }
  foreach ($procId in ($conns.OwningProcess | Select-Object -Unique)) {
    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
      Write-Host "已停止端口 $port（PID $procId）" -ForegroundColor Green
      $found = $true
    } catch { }
  }
}
if (-not $found) { Write-Host "没有发现正在运行的 LureCast 服务。" -ForegroundColor DarkGray }
