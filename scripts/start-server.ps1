<#
  LureCast 一键启动：起本地静态服务 + 打开默认浏览器
  双击「启动 LureCast.cmd」即可；参数：-Port 8123、-NoBrowser
#>
param(
  [int]$Port = 8123,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-PortBusy([int]$p) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', $p)
    $c.Close()
    return $true
  } catch { return $false }
}

function Test-IsLureCast([int]$p) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$p/index.html" -TimeoutSec 3 -UseBasicParsing
    return ($r.StatusCode -eq 200 -and $r.Content -match 'LureCast')
  } catch { return $false }
}

$chosen = 0
$already = $false
for ($p = $Port; $p -lt $Port + 12; $p++) {
  if (-not (Test-PortBusy $p)) { $chosen = $p; break }
  if (Test-IsLureCast $p) { $chosen = $p; $already = $true; break }
}
if ($chosen -eq 0) {
  Write-Host "找不到可用端口（$Port 起 12 个都被占用）" -ForegroundColor Red
  exit 1
}

$url = "http://127.0.0.1:$chosen/index.html"

if ($already) {
  Write-Host "LureCast 已经在运行：$url" -ForegroundColor Green
} else {
  # python 可能是 Microsoft Store 的占位程序：真跑一次确认可用
  $pyCmd = $null
  foreach ($cand in @('python', 'py')) {
    $c = Get-Command $cand -ErrorAction SilentlyContinue
    if (-not $c) { continue }
    try {
      $ver = & $c.Source --version 2>&1
      if ($LASTEXITCODE -eq 0 -and "$ver" -match 'Python \d') { $pyCmd = $c; break }
    } catch { }
  }
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue

  # 优先 Node 版 serve.mjs：它会发 Cache-Control: no-cache，改完代码刷新即生效。
  # python -m http.server 不带缓存头，浏览器会自己缓存 HTML，容易出现「页面还是旧的」。
  $title = "title LureCast server :$chosen  -  close this window to stop"
  if ($nodeCmd) {
    $cmdArgs = "/c $title & `"$($nodeCmd.Source)`" `"$root\scripts\serve.mjs`" $chosen `"$root`""
    Write-Host "使用 Node 静态服务（端口 $chosen，no-cache）…" -ForegroundColor Cyan
  } elseif ($pyCmd) {
    $cmdArgs = "/c $title & `"$($pyCmd.Source)`" -m http.server $chosen --bind 127.0.0.1 --directory `"$root`""
    Write-Host "未找到 Node，改用 Python 静态服务（端口 $chosen，浏览器可能缓存旧页面）…" -ForegroundColor Yellow
  } else {
    Write-Host "没有找到 Python 或 Node.js。" -ForegroundColor Red
    Write-Host "请安装 Python（https://www.python.org/downloads/，勾选 Add to PATH）后重试。" -ForegroundColor Yellow
    Write-Host "（直接双击 index.html 能看界面，但浏览器会拦掉定位与在线数据。）" -ForegroundColor Yellow
    if (-not $NoBrowser) { Start-Process (Join-Path $root 'index.html') }
    exit 1
  }

  Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdArgs -WorkingDirectory $root -WindowStyle Minimized

  $ok = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-IsLureCast $chosen) { $ok = $true; break }
  }
  if (-not $ok) {
    Write-Host "服务已启动但页面没响应，请手动打开 $url 看看" -ForegroundColor Yellow
  }
}

if (-not $NoBrowser) {
  Write-Host "正在打开浏览器：$url" -ForegroundColor Green
  Start-Process $url
} else {
  Write-Host "(-NoBrowser) $url"
}

Write-Host ""
Write-Host "  地址      $url" -ForegroundColor Green
Write-Host "  停止      关掉那个最小化的 LureCast server 窗口即可" -ForegroundColor DarkGray
Write-Host "  手机访问  http://<本机IP>:$chosen/index.html  （浏览器只在 https 或 localhost 下给 GPS）" -ForegroundColor DarkGray
