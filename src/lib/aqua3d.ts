// @ts-nocheck
/* LureCast · 水族馆 3D（three.js r170，自托管）
   ---------------------------------------------------------------------------
   做法：**实景底片 + 3D 演员**（电影/产品渲染的常规套路，不是自己「画」水）
   - 底景 = assets/fish/scene.webp（真实水下照：天光、水草、沙底、藻石）。
     着色器里加折射抖动、水的纵向吸收、轻微饱和与暗角，画面是「动的水」而不是壁纸；
     按 cover 方式铺满，竖屏裁两侧、横条裁上下，**不拉伸**（拉伸一眼假）。
   - 鱼是 3D 平面：顶点着色器摆尾 + 身体中段起浮，片元着色器做 5 tap 软边
     （近处实、远处虚，抵掉「贴纸糊上去」的硬边），并按距离去饱和、压暗、加雾。
   - 悬浮颗粒 + 上浮气泡 + 微弱光柱 + 相机缓慢漂移与滚转，水里不再干净得像 CG。
   - 位置/尺寸全部按「当前画幅在该深度下的可见范围」归一化：卡片横条、全屏竖屏
     都不会出现鱼被切半个身子。

   体积：three.js 675 KB 独立 chunk 懒加载；贴图沿用 assets/fish/。
   失败（无 WebGL / 解码失败）返回 null，调用方回退 2D 画法。 */
import threeUrl from '../../assets/vendor/three.module.min.js?url'
import bgUrl from '../../assets/fish/scene.webp?url'

let THREE: any = null
async function loadThree() {
  if (!THREE) THREE = await import(/* @vite-ignore */ threeUrl)
  return THREE
}

const MAX_FISH = 10
const FOV = 42
const BG_Z = -14

/* ---------------------------------------------------------------- 着色器 */

/* 底景：折射抖动 + 水下纵向吸收 + 轻饱和 + 暗角 + 极轻颗粒 */
const BG_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const BG_FRAG = `
uniform sampler2D uMap;
uniform float uTime, uVig, uWobble, uSat;
uniform vec2 uParallax;
uniform vec3 uDeep;
varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  // 两层不同频率的折射抖动：隔着水看东西的位移，很小但一直在动
  uv.x += sin(uv.y * 6.5 + uTime * 0.5) * 0.0024 * uWobble
        + sin(uv.y * 15.0 - uTime * 0.83) * 0.0012 * uWobble;
  uv.y += cos(uv.x * 5.5 + uTime * 0.37) * 0.0018 * uWobble;
  uv += uParallax;

  vec3 c = texture2D(uMap, clamp(uv, 0.002, 0.998)).rgb;

  // 水吸收：越往下越暗越青（红光先没）
  float d = 1.0 - vUv.y;
  vec3 absorb = mix(vec3(1.0), vec3(0.62, 0.82, 0.86), pow(d, 1.05) * 0.75);
  c *= absorb;
  c = mix(c, uDeep, pow(d, 2.0) * 0.10);

  // 轻饱和：webp 出来的照片略灰，提一点点
  float g = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(g), c, uSat);

  // 暗角（别太重，太重就成夜视了）
  vec2 q = vUv - vec2(0.5, 0.52);
  c *= 1.0 - dot(q, q) * uVig;

  // 极轻颗粒
  float n = fract(sin(dot(vUv * 1024.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * 0.010;

  gl_FragColor = vec4(c, 1.0);
}`

/* 鱼：尾巴（uv.x≈0 一侧）在顶点里摆动，身体中段带一点起浮 */
const FISH_VERT = `
uniform float uTime, uSpeed, uPhase, uWiggle;
varying vec2 vUv;
varying float vDepth;
void main() {
  vUv = uv;
  vec3 p = position;
  float tail = pow(clamp(1.0 - uv.x, 0.0, 1.0), 2.0);
  p.z += sin(uTime * uSpeed + uPhase + uv.x * 4.6) * tail * uWiggle;
  p.y += sin(uTime * uSpeed * 0.6 + uPhase - uv.x * 2.2) * 0.02 * (0.35 + tail);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`

const FISH_FRAG = `
uniform sampler2D uMap;
uniform vec3 uFogColor;
uniform float uOpacity, uFogDensity, uDepthTint, uLight, uBlur;
varying vec2 vUv;
varying float vDepth;

vec4 sampleSoft(vec2 uv) {
  if (uBlur < 0.01) return texture2D(uMap, uv);
  vec2 e = vec2(uBlur * 0.0016, uBlur * 0.0024);      // 5 tap：中心 + 四向，远处鱼边缘不再一刀切
  vec4 a = texture2D(uMap, uv);
  vec4 b = texture2D(uMap, uv + vec2(e.x, 0.0));
  vec4 c2 = texture2D(uMap, uv - vec2(e.x, 0.0));
  vec4 d2 = texture2D(uMap, uv + vec2(0.0, e.y));
  vec4 f2 = texture2D(uMap, uv - vec2(0.0, e.y));
  return (a * 2.0 + b + c2 + d2 + f2) / 6.0;
}

void main() {
  vec4 t = sampleSoft(vUv);
  if (t.a < 0.10) discard;
  vec3 c = t.rgb;
  // 水下照明：整条鱼不再全亮，暗部压一点，亮鳞留着
  c = mix(c * 0.66, c, 0.82 + 0.18 * vUv.y) * uLight;
  // 距离雾
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  c = mix(c, uFogColor, clamp(f, 0.0, 0.84));
  // 远去饱和（真雾吃对比）
  float g = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(g) * vec3(0.88, 0.99, 1.02), uDepthTint * 0.5);
  // 软边：alpha 过一道平滑，贴纸感来自硬边
  float a = smoothstep(0.10, 0.42, t.a) * uOpacity;
  gl_FragColor = vec4(c, a);
}`

/* ---------------------------------------------------------------- 工具 */

function canvasTex(T, w, h, draw) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new T.CanvasTexture(c)
  t.needsUpdate = true
  return t
}

/* 柔和圆点：颗粒 / 气泡共用 */
function dotTex(T, soft) {
  return canvasTex(T, 64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    grd.addColorStop(0, 'rgba(255,255,255,' + (soft ? 0.5 : 0.9) + ')')
    grd.addColorStop(0.45, 'rgba(220,245,255,' + (soft ? 0.16 : 0.3) + ')')
    grd.addColorStop(1, 'rgba(200,235,255,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, w, h)
  })
}

/**
 * 建场景。返回：
 *   setFishes(list)  [{ id, zh, color, layer }]
 *   setPerf(on)      性能优先：1x DPR、关颗粒/气泡/光柱
 *   resize()         尺寸变化后调用（内部也有 ResizeObserver）
 *   start()/stop()/dispose()
 */
export async function createAqua3D(canvas, opts = {}) {
  const T = await loadThree()

  const probe = document.createElement('canvas')
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return null

  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.outputColorSpace = T.SRGBColorSpace
  renderer.toneMapping = T.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.14

  const scene = new T.Scene()
  const deep = new T.Color(0x0a2f3c)
  const fogColor = new T.Color(0x12495d)
  scene.background = deep.clone()
  scene.fog = new T.FogExp2(fogColor.getHex(), 0.05)

  const camera = new T.PerspectiveCamera(FOV, 1, 0.1, 80)
  camera.position.set(0, 1.0, 5.0)
  const camTarget = new T.Vector3(0, 0.94, -1.0)

  const fogUniform = { value: 0.05 }

  /* ------------------------------------------------ 底景（实景照片，cover 铺满） */
  const bgTex = new T.TextureLoader().load(bgUrl)
  if ('colorSpace' in bgTex) bgTex.colorSpace = T.SRGBColorSpace
  bgTex.minFilter = T.LinearFilter
  const bgUniforms = {
    uMap: { value: bgTex },
    uTime: { value: 0 },
    uVig: { value: 0.85 },
    uWobble: { value: 1.0 },
    uSat: { value: 1.12 },
    uParallax: { value: new T.Vector2(0, 0) },
    uDeep: { value: deep }
  }
  const bgMat = new T.ShaderMaterial({ uniforms: bgUniforms, vertexShader: BG_VERT, fragmentShader: BG_FRAG })
  const bgMesh = new T.Mesh(new T.PlaneGeometry(1, 1), bgMat)
  bgMesh.position.set(0, 1.1, BG_Z)
  scene.add(bgMesh)

  /* ------------------------------------------------ 悬浮颗粒（水里总有东西漂着） */
  const moteCount = 420
  const motePos = new Float32Array(moteCount * 3)
  const moteSeed = new Float32Array(moteCount)
  for (let i = 0; i < moteCount; i++) {
    motePos[i * 3] = (Math.random() - 0.5) * 10
    motePos[i * 3 + 1] = Math.random() * 4.6
    motePos[i * 3 + 2] = -Math.random() * 10
    moteSeed[i] = Math.random()
  }
  const moteGeo = new T.BufferGeometry()
  moteGeo.setAttribute('position', new T.BufferAttribute(motePos, 3))
  moteGeo.setAttribute('aSeed', new T.BufferAttribute(moteSeed, 1))
  const moteMat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    uniforms: { uMap: { value: dotTex(T, true) }, uOpacity: { value: 0.45 } },
    vertexShader: `
      attribute float aSeed; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = -mv.z;
        vA = clamp(1.0 - d / 14.0, 0.0, 1.0) * (0.3 + 0.7 * aSeed);
        gl_PointSize = (1.5 + aSeed * 3.2) * 260.0 / max(0.4, d);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform float uOpacity; varying float vA;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        if (t.a < 0.02) discard;
        gl_FragColor = vec4(t.rgb, t.a * uOpacity * vA);
      }`
  })
  const motes = new T.Points(moteGeo, moteMat)
  scene.add(motes)

  /* ------------------------------------------------ 气泡 */
  const bubbleCount = 44
  const bPos = new Float32Array(bubbleCount * 3)
  const bSpeed = new Float32Array(bubbleCount)
  const bSize = new Float32Array(bubbleCount)
  for (let i = 0; i < bubbleCount; i++) {
    bPos[i * 3] = (Math.random() - 0.5) * 8
    bPos[i * 3 + 1] = Math.random() * 4
    bPos[i * 3 + 2] = -Math.random() * 8
    bSpeed[i] = 0.16 + Math.random() * 0.3
    bSize[i] = 0.02 + Math.random() * 0.04
  }
  const bubbleGeo = new T.BufferGeometry()
  bubbleGeo.setAttribute('position', new T.BufferAttribute(bPos, 3))
  bubbleGeo.setAttribute('aSize', new T.BufferAttribute(bSize, 1))
  const bubbleMat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    uniforms: { uMap: { value: dotTex(T, false) }, uOpacity: { value: 0.5 } },
    vertexShader: `
      attribute float aSize; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = -mv.z;
        vA = clamp(1.0 - d / 13.0, 0.0, 1.0);
        gl_PointSize = aSize * 1100.0 / max(0.3, d);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform float uOpacity; varying float vA;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        if (t.a < 0.02) discard;
        gl_FragColor = vec4(t.rgb, t.a * uOpacity * vA);
      }`
  })
  const bubbles = new T.Points(bubbleGeo, bubbleMat)
  scene.add(bubbles)

  /* ------------------------------------------------ 光柱（照片里已有天光，这里补一点会动的） */
  const shaftTex = canvasTex(T, 64, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h)
    grd.addColorStop(0, 'rgba(205,248,255,0.5)')
    grd.addColorStop(0.5, 'rgba(160,232,255,0.14)')
    grd.addColorStop(1, 'rgba(140,210,245,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, w, h)
    g.globalCompositeOperation = 'destination-in'
    const hg = g.createLinearGradient(0, 0, w, 0)
    hg.addColorStop(0, 'rgba(0,0,0,0)')
    hg.addColorStop(0.5, 'rgba(0,0,0,1)')
    hg.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = hg
    g.fillRect(0, 0, w, h)
  })
  const shafts = new T.Group()
  for (let i = 0; i < 5; i++) {
    const mat = new T.MeshBasicMaterial({
      map: shaftTex, transparent: true, opacity: 0.09, depthWrite: false,
      blending: T.AdditiveBlending, side: T.DoubleSide
    })
    const m = new T.Mesh(new T.PlaneGeometry(1.7, 10), mat)
    m.position.set((i - 2) * 1.9 + (Math.random() - 0.5) * 0.4, 3.1, -3.5 - Math.random() * 3.5)
    m.rotation.set(0.1, Math.random() * 0.5 - 0.25, 0.16 + Math.random() * 0.1)
    m.userData.phase = Math.random() * 6.28
    shafts.add(m)
  }
  scene.add(shafts)

  /* ------------------------------------------------ 河床焦散：画在下半屏，把「照片底」和「游动的鱼」绑在同一套光里 */
  const causticMat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAmt: { value: 0.17 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform float uTime, uAmt; varying vec2 vUv;
      void main() {
        float a = sin(vUv.x * 22.0 + sin(vUv.y * 9.0 + uTime * 0.6) * 3.0 + uTime * 0.55);
        float b = sin(vUv.y * 26.0 - sin(vUv.x * 7.0 + uTime * 0.4) * 2.6 - uTime * 0.42);
        float c = smoothstep(0.55, 1.0, abs(a * b));
        // 只出现在河床区（画面下半），最下沿淡出
        float mask = smoothstep(0.62, 0.18, vUv.y) * smoothstep(0.02, 0.16, vUv.y);
        gl_FragColor = vec4(vec3(0.55, 0.92, 1.0) * c * uAmt * mask, c * mask * 0.55);
      }`
  })
  const caustics = new T.Mesh(new T.PlaneGeometry(1, 1), causticMat)
  caustics.position.set(0, 0, BG_Z + 1)
  scene.add(caustics)

  /* 鱼的接地阴影：贴在「河床线」上的一团软黑，让鱼不像浮贴纸 */
  const shadowTex = canvasTex(T, 64, 32, (g, w, h) => {
    g.save(); g.translate(0, h / 2); g.scale(1, h / w); g.translate(0, -h / 2)
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    grd.addColorStop(0, 'rgba(0,0,0,0.9)')
    grd.addColorStop(0.5, 'rgba(0,0,0,0.34)')
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd
    g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, 6.2832); g.fill(); g.restore()
  })
  const shadowGroup = new T.Group()
  scene.add(shadowGroup)
  let shadows = []

  /* ------------------------------------------------ 鱼 */
  const texLoader = new T.TextureLoader()
  const texCache = new Map()
  function fishTex(id) {
    if (!texCache.has(id)) {
      const t = texLoader.load('assets/fish/' + id + '.webp')
      if ('colorSpace' in t) t.colorSpace = T.SRGBColorSpace
      t.anisotropy = 4
      texCache.set(id, t)
    }
    return texCache.get(id)
  }

  const fishGroup = new T.Group()
  scene.add(fishGroup)
  let fishes = []

  function clearFishes() {
    fishes.forEach((f) => {
      fishGroup.remove(f.mesh)
      f.mesh.geometry.dispose()
      f.mesh.material.dispose()
    })
    fishes = []
    shadows.forEach((s) => { shadowGroup.remove(s); s.geometry.dispose(); s.material.dispose() })
    shadows = []
  }

  /* 四档深度 + 水层高度，同缸鱼不重叠、不排成一排 */
  function setFishes(list) {
    clearFishes()
    const items = (list || []).slice(0, MAX_FISH)
    items.forEach((sp, i) => {
      const geo = new T.PlaneGeometry(1, 0.42, 28, 4)
      const mat = new T.ShaderMaterial({
        transparent: true, side: T.DoubleSide, depthWrite: false,
        uniforms: {
          uMap: { value: fishTex(sp.id) },
          uTime: { value: 0 },
          uSpeed: { value: 2.1 + Math.random() * 1.0 },
          uPhase: { value: Math.random() * 6.283 },
          uWiggle: { value: 0.05 + Math.random() * 0.03 },
          uOpacity: { value: 1 },
          uFogColor: { value: fogColor },
          uFogDensity: fogUniform,
          uDepthTint: { value: 0.2 },
          uLight: { value: 1 },
          uBlur: { value: 0 }
        },
        vertexShader: FISH_VERT, fragmentShader: FISH_FRAG
      })
      const mesh = new T.Mesh(geo, mat)
      fishGroup.add(mesh)
      /* 每条鱼配一团接地阴影，位置每帧跟着算 */
      const shadow = new T.Mesh(
        new T.PlaneGeometry(1, 1),
        new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0 })
      )
      shadowGroup.add(shadow)
      shadows.push(shadow)

      const isBot = sp.layer === 'bot' || (typeof sp.layer === 'string' && sp.layer.indexOf('bot') >= 0)
      const isTop = sp.layer === 'top'
      const band = i % 4
      const z = band === 0 ? -0.8 - Math.random() * 0.7
        : band === 1 ? -2.1 - Math.random() * 0.8
          : band === 2 ? -3.4 - Math.random() * 0.9
            : -4.6 - Math.random() * 1.0
      /* 竖直落位：按水层，再按深度往中间收（避免切边、也符合透视） */
      let ny = isTop ? 0.42 : isBot ? -0.30 : 0.08
      ny += (Math.random() - 0.5) * 0.2
      ny *= [1, 0.9, 0.78, 0.68][band]

      fishes.push({
        mesh, mat, shadow, sp,
        nx: 0.34 + Math.random() * 0.44,   // 横向巡游幅度（占可见半宽）
        nw: 0.13 + Math.random() * 0.12,   // 体长（占可见宽度）
        z,
        ny,
        dir: Math.random() > 0.5 ? 1 : -1,
        speed: 0.13 + Math.random() * 0.12,
        phase: Math.random() * 6.283,
        bob: 0.02 + Math.random() * 0.03,
        band
      })
    })
  }

  /* ------------------------------------------------ 取景：按画幅算可见范围 */
  function visibleAt(z) {
    const d = Math.max(0.5, camera.position.z - z)
    const halfH = Math.tan((FOV * Math.PI / 180) / 2) * d
    return { halfH, halfW: halfH * camera.aspect, d }
  }

  function resize() {
    const w = Math.max(1, canvas.clientWidth)
    const h = Math.max(1, canvas.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()

    /* 底景 cover：保持照片比例，多出来的边裁掉（竖屏裁左右、横条裁上下），绝不拉伸 */
    const bgD = camera.position.z - bgMesh.position.z
    const needH = 2 * Math.tan((FOV * Math.PI / 180) / 2) * bgD
    const needW = needH * camera.aspect
    const img = bgTex.image
    const texAspect = img && img.width && img.height ? img.width / img.height : 1
    const scaleH = Math.max(needH * 1.02, (needW * 1.02) / texAspect)
    const scaleW = scaleH * texAspect
    bgMesh.scale.set(scaleW, scaleH, 1)
    /* 焦散层铺在同一套视锥上 */
    const cD = Math.abs(camera.position.z - caustics.position.z)
    const cH = 2 * Math.tan((FOV * Math.PI / 180) / 2) * cD
    caustics.scale.set(cH * camera.aspect, cH, 1)
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null
  if (ro) ro.observe(canvas)
  resize()

  /* ------------------------------------------------ 跑帧 */
  let raf = 0
  let running = false
  let perf = !!opts.perf
  let last = 0
  const t0 = performance.now()

  function applyPerf() {
    renderer.setPixelRatio(perf ? 1 : Math.min(1.5, window.devicePixelRatio || 1))
    shafts.visible = !perf
    bubbles.visible = !perf
    motes.visible = !perf
    bgUniforms.uWobble.value = perf ? 0.4 : 1
    resize()
  }
  applyPerf()

  function frame(now) {
    if (!running) return
    raf = requestAnimationFrame(frame)
    const t = (now - t0) / 1000
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
    last = now

    /* 相机：贴着水底慢慢漂 + 一点滚转，像手持而不是三脚架 */
    const camX = Math.sin(t * 0.073) * 0.16
    camera.position.x = camX
    camera.position.y = 1.0 + Math.sin(t * 0.049) * 0.035
    camera.lookAt(camTarget)
    camera.rotation.z += Math.sin(t * 0.031) * 0.005

    bgUniforms.uTime.value = t
    causticMat.uniforms.uTime.value = t
    bgUniforms.uParallax.value.set(-camX * 0.0035, Math.sin(t * 0.036) * 0.003)

    shafts.children.forEach((m, i) => {
      m.material.opacity = 0.15 + Math.sin(t * 0.5 + m.userData.phase) * 0.05
      if (!perf) m.rotation.z = 0.16 + Math.sin(t * 0.18 + i) * 0.02
    })

    if (!perf) {
      const mp = moteGeo.getAttribute('position')
      for (let i = 0; i < moteCount; i++) {
        mp.array[i * 3 + 1] += (0.008 + moteSeed[i] * 0.014) * dt
        mp.array[i * 3] += Math.sin(t * 0.4 + moteSeed[i] * 6.28) * 0.0009
        if (mp.array[i * 3 + 1] > 4.8) mp.array[i * 3 + 1] = -0.1
      }
      mp.needsUpdate = true

      const bp = bubbleGeo.getAttribute('position')
      for (let i = 0; i < bubbleCount; i++) {
        let y = bp.array[i * 3 + 1] + bSpeed[i] * dt
        if (y > 4.2) { y = -0.05; bp.array[i * 3] = (Math.random() - 0.5) * 8 }
        bp.array[i * 3 + 1] = y
        bp.array[i * 3] += Math.sin(t * 1.1 + i) * 0.0014
      }
      bp.needsUpdate = true
    }

    /* 鱼：位置与尺寸按「当前画幅在该深度下的可见范围」归一化 */
    fishes.forEach((f) => {
      const { halfH, halfW, d } = visibleAt(f.z)
      const a = f.phase + t * f.speed * f.dir
      let x = Math.cos(a) * f.nx * halfW
      const drift = Math.sin(t * 0.42 + f.phase) * 0.055
      let y = (f.ny + drift) * halfH + Math.sin(t * 0.9 + f.phase) * f.bob * halfH * 0.25
      const s = f.nw * halfW * 2
      /* 横向也留出体长的一半，卡片横条/全屏竖屏都不会切到鱼头鱼尾 */
      const maxX = Math.max(0, halfW - s * 0.62)
      x = Math.max(-maxX, Math.min(maxX, x))
      const halfFish = s * 0.21
      y = Math.max(-halfH + halfFish * 1.7, Math.min(halfH - halfFish * 1.7, y))

      f.mesh.position.set(x, y, f.z)
      /* billboard：只绕 Y 转，再按「屏幕内水平速度」翻转，掉头不会倒着游 */
      const dx = -Math.sin(a) * f.dir
      const toCam = Math.atan2(camera.position.x - x, camera.position.z - f.z)
      const vLocalX = dx * Math.cos(toCam)
      f.mesh.rotation.set(0, toCam + (vLocalX >= 0 ? 0 : Math.PI), Math.sin(t * 0.7 + f.phase) * 0.03)
      f.mesh.scale.set(s, s, s)
      f.mat.uniforms.uTime.value = t

      /* 远的：更淡、更雾、更平，并且边缘更虚（假景深，抵掉贴纸硬边） */
      const far = Math.min(1, Math.max(0, (d - 4.2) / 6))
      f.mat.uniforms.uOpacity.value = 1 - far * 0.1
      f.mat.uniforms.uDepthTint.value = 0.18 + far * 0.55
      f.mat.uniforms.uLight.value = 1.0 - far * 0.22
      f.mat.uniforms.uBlur.value = 0.5 + far * 2.2

      /* 接地阴影：贴在河床线上（画面下方 32% 处），越靠底越实；远了就基本看不见 */
      const bedY = -halfH * 0.62
      const gap = Math.max(0, (y - bedY) / (halfH * 0.9))     // 鱼离床越远，影子越大越淡
      const sw = s * (1.0 + gap * 0.5)
      f.shadow.position.set(x - s * 0.04, bedY, f.z)
      f.shadow.scale.set(sw, sw * 0.34, 1)
      f.shadow.material.opacity = (0.42 - gap * 0.22) * (1 - far * 0.55)
    })

    renderer.render(scene, camera)
  }

  function start() {
    if (running) return
    running = true
    last = 0
    raf = requestAnimationFrame(frame)
  }
  function stop() {
    running = false
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }
  function setPerf(on) {
    perf = !!on
    applyPerf()
  }
  function dispose() {
    stop()
    if (ro) ro.disconnect()
    texCache.forEach((t) => t.dispose())
    clearFishes()
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) {
        if (o.material.map) o.material.map.dispose()
        o.material.dispose()
      }
    })
    renderer.dispose()
  }

  return { setFishes, start, stop, setPerf, resize, dispose, renderer }
}
