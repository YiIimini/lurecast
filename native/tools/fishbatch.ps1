# 25 种鱼的写实侧视贴图：Qwen-Image 出图 → 按键色差抠图 → 512px WebP
# 用法：
#   .\fishbatch.ps1                 # 只补缺（assets/fish/<id>.webp 不存在才生成）
#   .\fishbatch.ps1 -Force          # 全部重出
#   .\fishbatch.ps1 -Only bass,pike # 指定几种重出
# 前提：本机 ComfyUI 在 127.0.0.1:8199（D:\Ai\ComfyUI\start-comfyui.cmd）
# 2026-10-18 改：所有鱼一律闭着嘴出图（negative 里显式排除张嘴/露牙/张颌）。
param(
  [switch]$Force,
  [string[]]$Only = @(),
  [string]$OutDir = "",
  [int]$SeedBase = 20261018
)
$ErrorActionPreference = 'Continue'
$here = $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $here '..\..\assets\fish' }
$OutDir = (Resolve-Path $OutDir).Path
$raw = Join-Path $env:PI_SCRATCH_DIR 'fish\raw'
New-Item -ItemType Directory -Force -Path $raw, $OutDir | Out-Null
$py = 'D:\Ai\ComfyUI\standalone-env\python.exe'

$species = @(
  @{ id = 'bass';            desc = 'a largemouth bass (Micropterus salmoides), olive-green flanks with a broad dark lateral band, large jaw, spiny first dorsal fin' },
  @{ id = 'topmouth';        desc = 'a topmouth culter (Culter alburnus), very slender bright silver body, finely scaled, deeply forked tail, strongly upturned lower jaw' },
  @{ id = 'mandarin';        desc = 'a mandarin fish (Siniperca chuatsi), high-backed golden-brown body with irregular dark blotches, large head, rounded tail fin' },
  @{ id = 'snakehead';       desc = 'a northern snakehead (Channa argus), long cylindrical olive body with dark irregular blotches, very long dorsal and anal fins, rounded tail' },
  @{ id = 'zander';          desc = 'a zander (Sander lucioperca), elongated silver-grey body with dark vertical bars, spiny dorsal fin, glassy reflective eye' },
  @{ id = 'trout';           desc = 'a rainbow trout (Oncorhynchus mykiss), silvery body with a pink lateral stripe and small black spots, small adipose fin near the tail' },
  @{ id = 'chub';            desc = 'an Opsariichthys bidens (Chinese hooksnout minnow), small slender olive-silver stream fish, forked tail, prominent lower jaw' },
  @{ id = 'bleeker';         desc = 'a sharpbelly (Hemiculter leucisculus), very slender silvery fish, pointed head, deeply forked tail' },
  @{ id = 'catfish';         desc = 'an Amur catfish (Silurus asotus), long dark olive mottled body, two long whisker barbels, very long anal fin' },
  @{ id = 'yellowcat';       desc = 'a yellow catfish (Pelteobagrus fulvidraco), yellow body with dark blotches, four barbels, small adipose fin' },
  @{ id = 'skygazer';        desc = 'a yellowcheek carp (Elopichthys bambusa), large torpedo-shaped silver body, strong forked tail, pointed head' },
  @{ id = 'tilapia';         desc = 'a Nile tilapia (Oreochromis niloticus), deep-bodied grey-green fish with faint vertical bars, long spiny dorsal fin' },
  @{ id = 'carp';            desc = 'a common carp (Cyprinus carpio), golden-brown body with large scales, two barbels, long dorsal fin' },
  @{ id = 'crucian';         desc = 'a crucian carp (Carassius auratus), deep-bodied silver-gold fish with large scales, long dorsal fin' },
  @{ id = 'seabass';         desc = 'a Japanese sea bass (Lateolabrax japonicus), silvery elongated body, spiny dorsal fin' },
  @{ id = 'blackporgy';      desc = 'a black sea bream (Acanthopagrus schlegelii), deep-bodied silver-grey fish, tall spiny dorsal fin' },
  @{ id = 'grouper';         desc = 'an orange-spotted grouper (Epinephelus coioides), robust brown body with dark spots, heavy head, rounded tail' },
  @{ id = 'flatfish';        desc = 'an olive flounder (Paralichthys olivaceus), flat oval brown mottled body, both eyes on the upper side, fringed dorsal and anal fins' },
  @{ id = 'spanishmackerel'; desc = 'a Japanese Spanish mackerel (Scomberomorus niphonius), torpedo-shaped blue-silver body with dark spots, crescent tail' },
  @{ id = 'yellowtail';      desc = 'a yellowfin tuna (Thunnus albacares), fusiform dark blue back with bright yellow fins, crescent tail' },
  @{ id = 'mahi';            desc = 'a mahi-mahi (Coryphaena hippurus), iridescent green-gold body, very long dorsal fin running from head to tail, blunt forehead' },
  @{ id = 'barramundi';      desc = 'a barramundi (Lates calcarifer), silvery body, sloping forehead, rounded tail' },
  @{ id = 'pike';            desc = 'a northern pike (Esox lucius), long green body with pale spots, flat duckbill snout, dorsal and anal fins set far back near the tail' },
  @{ id = 'cobia';           desc = 'a cobia (Rachycentron canadum), elongated brown body with a broad flat head and a dark lateral stripe' },
  @{ id = 'amberjack';       desc = 'a greater amberjack (Seriola dumerili), amber-yellow body with a yellow lateral stripe, forked tail' }
)

# 闭嘴：正面写进 prompt，反面再排一遍（出图后要逐张看头部特写才算过）
$mouthClosed = 'with its mouth completely closed, lips firmly pressed together, jaw shut, no gap between the jaws, no teeth showing'
$negative = 'open mouth, gaping mouth, parted lips, open jaw, wide open mouth, visible teeth, tongue, yawning, gasping, ' +
  'water, ripples, caustics, rocks, plants, coral, multiple fish, text, letters, watermark, signature, frame, border, ' +
  'blurry, out of focus, cropped, cut off, distorted anatomy, extra fins, plastic toy, illustration, cartoon, painting, drawing'

$todo = $species
if ($Only.Count -gt 0) { $todo = $species | Where-Object { $Only -contains $_.id } }
$n = 0
foreach ($s in $todo) {
  $n++
  $tag = "[$n/$($todo.Count)]"
  $webp = Join-Path $OutDir "$($s.id).webp"
  if (-not $Force -and (Test-Path $webp)) { "$tag skip $($s.id)"; continue }

  $prompt = "Photorealistic studio photograph of a single $($s.desc). Complete full body, perfect side profile view, facing right, " +
    "$mouthClosed, fins naturally spread, wet glossy skin with fine scale detail, razor sharp focus, evenly lit, " +
    "isolated on a perfectly flat uniform solid dark teal background, plain empty background, no shadow on the background, no water, no props"

  $t0 = Get-Date
  $rawFile = Join-Path $raw "$($s.id).png"
  Remove-Item $rawFile -ErrorAction SilentlyContinue
  & (Join-Path $here 'fishgen.ps1') -Prompt $prompt -Negative $negative -Out $rawFile -W 1024 -H 768 `
    -Seed ([string]($SeedBase + $n * 977)) -Prefix "fish" | Out-Host
  if (-not (Test-Path $rawFile)) { "$tag FAIL gen $($s.id)"; continue }

  $png = Join-Path $raw "$($s.id).cut.png"
  & $py (Join-Path $here 'fishcut.py') $rawFile $png 512 | Out-Host
  if (-not (Test-Path $png)) { "$tag FAIL cut $($s.id)"; continue }

  & $py -c "from PIL import Image; im=Image.open(r'$png').convert('RGBA'); im.save(r'$webp','WEBP',quality=82,method=6)" | Out-Host
  if (Test-Path $webp) {
    "$tag OK $($s.id) $([math]::Round(((Get-Date)-$t0).TotalSeconds))s $([int]((Get-Item $webp).Length/1024))KB"
  } else {
    "$tag FAIL webp $($s.id)"
  }
}
"done"
