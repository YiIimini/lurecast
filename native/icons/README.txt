LureCast 安卓图标：生成记录
=====================================

生成方式：本机 ComfyUI（D:\Ai\ComfyUI，端口 8199）+ Qwen-Image 2.1
  unet : qwen_image_2.1_int8_convrot.safetensors
  clip : qwen3vl_8b_int8_convrot.safetensors  (type=qwen_image，必须 8B：7B 是 3584 维会报维度错)
  vae  : qwen_image_2.1_vae_bf16.safetensors
  采样 : euler / simple，22 步，cfg 2.8，1024×1024

提示词（正面）
--------------
App icon, square 1:1. Concept: finding a lure-fishing spot. One bold map location pin (teardrop marker)
tilted slightly, its lower tip touching two soft concentric water ripples; inside the pin's round head,
a stylized cyan fish biting a small silver spoon lure with a treble hook on a thin line. Deep navy to
near-black background with subtle teal glow, mint and violet accents, clean flat vector style with soft
3D shading, thick crisp edges, only three shapes (pin, fish, ripples), lots of empty margin, strong
silhouette, no text, no letters, no numbers, no frame, no border, high contrast, still readable at 48 pixels

提示词（负面）
--------------
text, letters, words, numbers, watermark, signature, border, frame, cluttered, busy background,
multiple fish, photo, realistic photograph, blurry, low contrast, noisy, cropped subject, distorted anatomy

选中：pin_2.png（定位针带紫色描边、鱼咬亮片、针尖落进涟漪），存为 icons/source/icon-1024-source.png

合成到安卓（native\icons\make-android-icons.ps1）
------------------------------------------------
· 自适应图标：把整张图按 0.86 缩放居中铺在同色底上 → drawable-*/ic_launcher_bg.png（全出血，启动器自己裁剪）
· 旧版图标：同底图做圆角方块 / 圆形 → mipmap-*/ic_launcher(.png|_round.png)
· monochrome：保留矢量鱼标 drawable/ic_launcher_foreground.xml
· 同步更新网页图标 icons/icon-192.png、icon-512.png

重新生成：
  native\icons\comfy-gen.ps1 -Prompt "<上面的提示词>" -OutPrefix pin -Batch 2 -Seed 31011
  native\icons\comfy-wait.ps1
  native\icons\make-android-icons.ps1 -SourcePng <下载到的 png> -ArtScale 0.86
