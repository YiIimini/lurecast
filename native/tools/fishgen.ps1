param(
  [Parameter(Mandatory=$true)][string]$Prompt,
  [string]$Negative = "water, ripples, caustics, rocks, plants, coral, multiple fish, text, letters, watermark, signature, frame, border, blurry, out of focus, cropped, cut off, distorted anatomy, extra fins, plastic toy, illustration, cartoon, painting, drawing",
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$W = 1024,
  [int]$H = 768,
  [int]$Steps = 26,
  [double]$Cfg = 3.0,
  [string]$Seed = "20261018",
  [int]$TimeoutSec = 900,
  [string]$Prefix = "fish",
  [string]$Unet = "qwen_image_2.1_int8_convrot.safetensors",
  [string]$ClipFile = "qwen3vl_8b_int8_convrot.safetensors",
  [string]$ClipType = "qwen_image",
  [string]$Vae = "qwen_image_2.1_vae_bf16.safetensors"
)

$wf = [ordered]@{}
$wf["1"] = @{ class_type = "UNETLoader"; inputs = @{ unet_name = $Unet; weight_dtype = "default" } }
$wf["2"] = @{ class_type = "CLIPLoader"; inputs = @{ clip_name = $ClipFile; type = $ClipType } }
$wf["3"] = @{ class_type = "VAELoader"; inputs = @{ vae_name = $Vae } }
$wf["4"] = @{ class_type = "CLIPTextEncode"; inputs = @{ text = $Prompt; clip = @("2", 0) } }
$wf["5"] = @{ class_type = "CLIPTextEncode"; inputs = @{ text = $Negative; clip = @("2", 0) } }
$wf["6"] = @{ class_type = "EmptyLatentImage"; inputs = @{ width = $W; height = $H; batch_size = 1 } }
$wf["7"] = @{ class_type = "KSampler"; inputs = @{
    model = @("1", 0); positive = @("4", 0); negative = @("5", 0); latent_image = @("6", 0)
    seed = [int]$Seed; steps = $Steps; cfg = $Cfg
    sampler_name = "euler"; scheduler = "simple"; denoise = 1.0 } }
$wf["8"] = @{ class_type = "VAEDecode"; inputs = @{ samples = @("7", 0); vae = @("3", 0) } }
$wf["9"] = @{ class_type = "SaveImage"; inputs = @{ images = @("8", 0); filename_prefix = $Prefix } }

$json = (@{ prompt = $wf; client_id = "pi-fish" } | ConvertTo-Json -Depth 20 -Compress)
$resp = Invoke-RestMethod -Uri 'http://127.0.0.1:8199/prompt' -Method Post -ContentType 'application/json; charset=utf-8' `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 120
$id = $resp.prompt_id
# 不信 /history（本机实测会漏判），直接等输出目录里出现新图
$outDir = "D:\Ai\ComfyUI\ComfyUI\output"
$before = @{}
Get-ChildItem $outDir -Filter "$Prefix`_*.png" -ErrorAction SilentlyContinue | ForEach-Object { $before[$_.Name] = $true }
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$file = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 2500
  $cand = Get-ChildItem $outDir -Filter "$Prefix`_*.png" -ErrorAction SilentlyContinue |
    Where-Object { -not $before.ContainsKey($_.Name) } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($cand) {
    Start-Sleep -Milliseconds 800
    $cand.Refresh()
    if ($cand.Length -gt 10000) { $file = $cand; break }
  }
}
if (-not $file) { Write-Host "TIMEOUT"; exit 1 }

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
Copy-Item $file.FullName $Out -Force
Write-Host "saved $Out ($((Get-Item $Out).Length) bytes)"
