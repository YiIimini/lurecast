# 把 ComfyUI 生成的图标合成安卓各档位资源
#   自适应图标：全出血背景（launcher 自己裁剪）+ 透明前景 + 矢量 monochrome
#   旧版图标：圆角方块 / 圆形，透明角
param(
  # 源图：一张 1024×1024 的方形 PNG（默认取 icons/source/icon-1024-source.png）
  [string]$SourcePng = (Join-Path $PSScriptRoot "..\..\icons\source\icon-1024-source.png"),
  [string]$ResDir = (Join-Path $PSScriptRoot "..\android\app\src\main\res"),
  [string]$WebIcons = (Join-Path $PSScriptRoot "..\..\icons"),
  [double]$ArtScale = 0.88
)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

function New-Canvas([int]$size) {
  [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}
function Get-Gfx($bmp) {
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g
}
function Get-CornerColor($bmp) {
  $w = $bmp.Width; $h = $bmp.Height; $ix = [int]($w * 0.12); $iy = [int]($h * 0.12)
  $pts = @( ,@($ix, $iy) ) + @( ,@(($w - $ix), $iy) ) + @( ,@($ix, ($h - $iy)) ) + @( ,@(($w - $ix), ($h - $iy)) )
  $r = 0; $g = 0; $b = 0
  foreach ($p in $pts) { $c = $bmp.GetPixel($p[0], $p[1]); $r += $c.R; $g += $c.G; $b += $c.B }
  [System.Drawing.Color]::FromArgb(255, [int]($r / 4), [int]($g / 4), [int]($b / 4))
}
function New-Flat([int]$size, $color) {
  $bmp = New-Canvas $size
  $g = Get-Gfx $bmp
  $g.Clear($color)
  $g.Dispose()
  $bmp
}
function New-Rounded($bmp, [int]$size, [double]$radiusPct) {
  $out = New-Canvas $size
  $g = Get-Gfx $out
  $r = [Math]::Max(2, [int]($size * $radiusPct))
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc(0, 0, $r, $r, 180, 90)
  $path.AddArc($size - $r, 0, $r, $r, 270, 90)
  $path.AddArc($size - $r, $size - $r, $r, $r, 0, 90)
  $path.AddArc(0, $size - $r, $r, $r, 90, 90)
  $path.CloseFigure()
  $g.SetClip($path)
  $g.DrawImage($bmp, [System.Drawing.Rectangle]::new(0, 0, $size, $size))
  $g.ResetClip(); $g.Dispose(); $path.Dispose()
  $out
}
function New-Circle($bmp, [int]$size) {
  $out = New-Canvas $size
  $g = Get-Gfx $out
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddEllipse(0, 0, $size, $size)
  $g.SetClip($path)
  $g.DrawImage($bmp, [System.Drawing.Rectangle]::new(0, 0, $size, $size))
  $g.ResetClip(); $g.Dispose(); $path.Dispose()
  $out
}

$srcBmp = [System.Drawing.Bitmap]::new($SourcePng)
"源图: $($srcBmp.Width)x$($srcBmp.Height)  文件: $(Split-Path -Leaf $SourcePng)"
$corner = Get-CornerColor $srcBmp
"角落底色: #{0:X2}{1:X2}{2:X2}" -f $corner.R, $corner.G, $corner.B

# 1) 基础画布：同色底 + 主体按 ArtScale 缩放居中（全出血）
$artBase = New-Flat 1024 $corner
$g = Get-Gfx $artBase
$w = [int](1024 * $ArtScale)
$off = [int]((1024 - $w) / 2)
$g.DrawImage($srcBmp, [System.Drawing.Rectangle]::new($off, $off, $w, $w))
$g.Dispose()

# 2) 自适应图标背景（各密度全出血方图）
$bgSizes = [ordered]@{ 'mdpi' = 108; 'hdpi' = 162; 'xhdpi' = 216; 'xxhdpi' = 324; 'xxxhdpi' = 432 }
foreach ($k in $bgSizes.Keys) {
  $dir = Join-Path $ResDir "drawable-$k"
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $s = $bgSizes[$k]
  $bmp = New-Canvas $s
  $g = Get-Gfx $bmp
  $g.DrawImage($artBase, [System.Drawing.Rectangle]::new(0, 0, $s, $s))
  $g.Dispose()
  $p = Join-Path $dir 'ic_launcher_bg.png'
  $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  "背景 $k ${s}px -> $p"
}

# 3) 旧版图标（圆角）与圆形图标
$legacy = [ordered]@{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }
foreach ($k in $legacy.Keys) {
  $s = $legacy[$k]
  $round = New-Rounded $artBase $s 0.22
  $round.Save((Join-Path $ResDir "mipmap-$k\ic_launcher.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $round.Dispose()
  $circ = New-Circle $artBase $s
  $circ.Save((Join-Path $ResDir "mipmap-$k\ic_launcher_round.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $circ.Dispose()
  "旧版图标 $k ${s}px 完成"
}

# 4) 网页 / PWA 图标
$w512 = New-Rounded $artBase 512 0.22
$w512.Save((Join-Path $WebIcons 'icon-512.png'), [System.Drawing.Imaging.ImageFormat]::Png); $w512.Dispose()
$w192 = New-Rounded $artBase 192 0.22
$w192.Save((Join-Path $WebIcons 'icon-192.png'), [System.Drawing.Imaging.ImageFormat]::Png); $w192.Dispose()
"网页图标 icon-512.png / icon-192.png 已更新"

# 5) 预览（写到 icons/source/，与源图放一起）
$prevDir = Join-Path $WebIcons 'source'
New-Item -ItemType Directory -Force -Path $prevDir | Out-Null
$prev = New-Rounded $artBase 256 0.22
$prev.Save((Join-Path $prevDir 'preview-rounded.png'), [System.Drawing.Imaging.ImageFormat]::Png); $prev.Dispose()
$circPrev = New-Circle $artBase 256
$circPrev.Save((Join-Path $prevDir 'preview-circle.png'), [System.Drawing.Imaging.ImageFormat]::Png); $circPrev.Dispose()
$artBase.Dispose(); $srcBmp.Dispose()
"预览: icons/source/preview-rounded.png / preview-circle.png"

