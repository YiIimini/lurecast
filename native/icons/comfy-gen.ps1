# 用本机 ComfyUI(8199) 生成 LureCast 图标候选
#   支持自定义提示词与输出前缀：-Prompt -Negative -OutPrefix
param(
  [int]$Batch = 2,
  [int]$Steps = 22,
  [double]$Cfg = 2.8,
  [string]$Seed = "20261017",
  [string]$Prompt = "",
  [string]$Negative = "",
  [string]$OutPrefix = "icon",
  [string]$Unet = "qwen_image_2.1_int8_convrot.safetensors",
  [string]$ClipFile = "qwen3vl_8b_int8_convrot.safetensors",
  [string]$ClipType = "qwen_image",
  [string]$Vae = "qwen_image_2.1_vae_bf16.safetensors"
)

if (-not $Prompt) { throw "需要 -Prompt" }
if (-not $Negative) {
  $Negative = "text, letters, words, numbers, watermark, signature, border, frame, cluttered, busy background, multiple fish, photo, realistic photograph, blurry, low contrast, noisy, cropped subject, distorted anatomy"
}

$wf = [ordered]@{}
$wf["1"] = @{ class_type = "UNETLoader"; inputs = @{ unet_name = $Unet; weight_dtype = "default" } }
$wf["2"] = @{ class_type = "CLIPLoader"; inputs = @{ clip_name = $ClipFile; type = $ClipType } }
$wf["3"] = @{ class_type = "VAELoader"; inputs = @{ vae_name = $Vae } }
$wf["4"] = @{ class_type = "CLIPTextEncode"; inputs = @{ text = $Prompt; clip = @("2", 0) } }
$wf["5"] = @{ class_type = "CLIPTextEncode"; inputs = @{ text = $Negative; clip = @("2", 0) } }
$wf["6"] = @{ class_type = "EmptyLatentImage"; inputs = @{ width = 1024; height = 1024; batch_size = $Batch } }
$wf["7"] = @{ class_type = "KSampler"; inputs = @{
    model = @("1", 0); positive = @("4", 0); negative = @("5", 0); latent_image = @("6", 0)
    seed = [int]$Seed; steps = $Steps; cfg = $Cfg
    sampler_name = "euler"; scheduler = "simple"; denoise = 1.0 } }
$wf["8"] = @{ class_type = "VAEDecode"; inputs = @{ samples = @("7", 0); vae = @("3", 0) } }
$wf["9"] = @{ class_type = "SaveImage"; inputs = @{ images = @("8", 0); filename_prefix = "lurecast_$OutPrefix" } }

$json = (@{ prompt = $wf; client_id = "pi-lurecast-icon" } | ConvertTo-Json -Depth 20 -Compress)
$resp = Invoke-RestMethod -Uri 'http://127.0.0.1:8199/prompt' -Method Post -ContentType 'application/json; charset=utf-8' `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 60
Write-Host "prompt_id=$($resp.prompt_id)"
$resp.prompt_id | Set-Content -Path "$PSScriptRoot\last_prompt_id.txt"
$OutPrefix | Set-Content -Path "$PSScriptRoot\last_prefix.txt"
