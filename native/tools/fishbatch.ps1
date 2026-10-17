$ErrorActionPreference = 'Continue'
$scr = "C:\Users\Administrator\.pi-desktop\scratch\2434506d-efbb-4e77-a063-e44b657cb2a9"
$raw = "$scr\fish\raw"
$outDir = "D:\Ai\Datas\lurecast\assets\fish"
New-Item -ItemType Directory -Force -Path $raw, $outDir | Out-Null
$py = "D:\Ai\ComfyUI\standalone-env\python.exe"

$species = @(
  @{ id = 'bass';            desc = 'a largemouth bass (Micropterus salmoides), olive-green flanks with a broad dark lateral band, large mouth, spiny first dorsal fin' },
  @{ id = 'topmouth';        desc = 'a topmouth culter (Culter alburnus), very slender bright silver body, finely scaled, deeply forked tail, strongly upturned mouth' },
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
  @{ id = 'seabass';         desc = 'a Japanese sea bass (Lateolabrax japonicus), silvery elongated body, spiny dorsal fin, large mouth' },
  @{ id = 'blackporgy';      desc = 'a black sea bream (Acanthopagrus schlegelii), deep-bodied silver-grey fish, tall spiny dorsal fin' },
  @{ id = 'grouper';         desc = 'an orange-spotted grouper (Epinephelus coioides), robust brown body with dark spots, big mouth, rounded tail' },
  @{ id = 'flatfish';        desc = 'an olive flounder (Paralichthys olivaceus), flat oval brown mottled body, both eyes on the upper side, fringed dorsal and anal fins' },
  @{ id = 'spanishmackerel'; desc = 'a Japanese Spanish mackerel (Scomberomorus niphonius), torpedo-shaped blue-silver body with dark spots, crescent tail' },
  @{ id = 'yellowtail';      desc = 'a yellowfin tuna (Thunnus albacares), fusiform dark blue back with bright yellow fins, crescent tail' },
  @{ id = 'mahi';            desc = 'a mahi-mahi (Coryphaena hippurus), iridescent green-gold body, very long dorsal fin running from head to tail, blunt head' },
  @{ id = 'barramundi';      desc = 'a barramundi (Lates calcarifer), silvery body, large mouth, rounded tail' },
  @{ id = 'pike';            desc = 'a northern pike (Esox lucius), long green body with pale spots, duckbill snout, dorsal and anal fins set far back near the tail' },
  @{ id = 'cobia';           desc = 'a cobia (Rachycentron canadum), elongated brown body with a broad flat head and a dark lateral stripe' },
  @{ id = 'amberjack';       desc = 'a greater amberjack (Seriola dumerili), amber-yellow body with a yellow lateral stripe, forked tail' }
)

$n = 0
foreach ($s in $species) {
  $n++
  $out = "$outDir\$($s.id).png"
  if (Test-Path $out) { "[$n/$($species.Count)] skip $($s.id)"; continue }
  $prompt = "Photorealistic studio photograph of a single $($s.desc). Complete full body, perfect side profile view, facing right, fins naturally spread, wet glossy skin with fine scale detail, razor sharp focus, evenly lit, isolated on a perfectly flat uniform solid dark teal background, plain empty background, no shadow on the background, no water, no props"
  $t0 = Get-Date
  $rawFile = "$raw\$($s.id).png"
  & "$scr\fishgen.ps1" -Prompt $prompt -Out $rawFile -W 1024 -H 768 -Prefix "fish" | Out-Host
  if (-not (Test-Path $rawFile)) { "[$n/$($species.Count)] FAIL gen $($s.id)"; continue }
  & $py "$scr\fishcut.py" $rawFile $out 512 | Out-Host
  if (Test-Path $out) {
    "[$n/$($species.Count)] OK $($s.id) $([math]::Round(((Get-Date)-$t0).TotalSeconds))s $([int]((Get-Item $out).Length/1024))KB"
  } else {
    "[$n/$($species.Count)] FAIL cut $($s.id)"
  }
}
"done"
