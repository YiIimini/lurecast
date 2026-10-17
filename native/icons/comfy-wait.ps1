# 轮询 ComfyUI 任务并下载图片；文件名带前缀，互不覆盖
param([int]$TimeoutSec = 600)

$scr = "C:\Users\Administrator\.pi-desktop\scratch\2434506d-efbb-4e77-a063-e44b657cb2a9"
$id = (Get-Content "$scr\last_prompt_id.txt").Trim()
$prefix = if (Test-Path "$scr\last_prefix.txt") { (Get-Content "$scr\last_prefix.txt").Trim() } else { "icon" }
$out = "$scr\icons"
New-Item -ItemType Directory -Force -Path $out | Out-Null

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$done = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  try { $h = Invoke-RestMethod "http://127.0.0.1:8199/history/$id" -TimeoutSec 15 } catch { continue }
  if ($h.PSObject.Properties.Name -contains $id) { $done = $h.$id; break }
}
if (-not $done) { Write-Host "超时未完成"; exit 1 }

Write-Host "状态: $($done.status.status_str)"
if ($done.status.messages) {
  foreach ($m in $done.status.messages) {
    if ($m[0] -eq 'execution_error') {
      $d = $m[1]
      Write-Host ("错误节点: " + $d.node_type + " / " + $d.exception_type)
      Write-Host ("错误信息: " + ($d.exception_message -replace "`n", " "))
    }
  }
}
$imgs = @()
foreach ($nodeId in $done.outputs.PSObject.Properties.Name) {
  foreach ($im in $done.outputs.$nodeId.images) { $imgs += $im }
}
Write-Host "图片数: $($imgs.Count)"
$i = 0
foreach ($im in $imgs) {
  $i++
  $u = "http://127.0.0.1:8199/view?filename=" + [uri]::EscapeDataString($im.filename) +
       "&subfolder=" + [uri]::EscapeDataString($im.subfolder) + "&type=" + $im.type
  $file = Join-Path $out ($prefix + "_" + $i + ".png")
  Invoke-WebRequest $u -OutFile $file -TimeoutSec 60
  Write-Host ("  保存 " + $file + "  " + (Get-Item $file).Length + " B")
}
