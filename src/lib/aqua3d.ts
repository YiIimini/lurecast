// @ts-nocheck
/* LureCast · 水族馆 3D（three.js r170，自托管）—— 真三维水下场景
   ---------------------------------------------------------------------------
   为什么重做：原来的 2.5D canvas 是「贴图切片 + 手绘光斑」，看着像画，不像水下。
   这里用真三维：透视相机 + 指数雾 + 河床（带动态焦散）+ 斜射光柱 + 上浮气泡 +
   摆动的细草 + 鱼（顶点着色器摆尾、绕椭圆游动、按水层分布），并且只在组件可见时跑帧。

   体积与加载：three.js 675 KB 作为独立 chunk 懒加载（`?url` + 动态 import），
   不进 app chunk；贴图沿用 assets/fish/*.webp（Vite 插件已在构建时复制）。
   失败（无 WebGL / 解码失败）时返回 null，调用方回退到原来的 2D 画法。 */
import threeUrl from '../../assets/vendor/three.module.min.js?url'
import bedUrl from '../../assets/fish/bed-lake.webp?url'

let THREE: any = null
async function loadThree() {
  if (!THREE) THREE = await import(/* @vite-ignore */ threeUrl)
  return THREE
}

const WATER_TOP = 2.6
const BED_Y = 0.0
const LAYER_Y = { top: 1.55, mid: 0.95, bot: 0.28 }
const MAX_FISH = 12

/* 一个小工具：用 canvas 画贴图（气泡、光柱、草叶），避免再引入图片资源 */
function canvasTex(THREE, w, h, draw) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')
  draw(g, w, h)
  const t = new THREE.CanvasTexture(c)
  t.needsUpdate = true
  return t
}

/* 鱼：贴合贴图的四边形 + 顶点着色器摆尾（贴图里鱼头在右 → 尾巴在 uv.x≈0 一侧） */
const FISH_VERT = `
uniform float uTime, uSpeed, uPhase, uWiggle;
varying vec2 vUv;
varying float vDepth;
void main() {
  vUv = uv;
  vec3 p = position;
  float tail = pow(clamp(1.0 - uv.x, 0.0, 1.0), 2.0);
  p.z += sin(uTime * uSpeed + uPhase + uv.x * 4.6) * tail * uWiggle;
  p.y += sin(uTime * uSpeed * 0.55 + uPhase) * 0.012 * (1.0 - tail);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`

const FISH_FRAG = `
uniform sampler2D uMap;
uniform vec3 uFogColor;
uniform float uOpacity, uFogDensity, uDepthTint;
varying vec2 vUv;
varying float vDepth;
void main() {
  vec4 t = texture2D(uMap, vUv);
  if (t.a < 0.05) discard;
  vec3 c = t.rgb;
  // 越远越被水色吃掉（真雾效，不是叠一层灰）
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  c = mix(c, uFogColor, clamp(f, 0.0, 0.9));
  c = mix(c, c * vec3(0.86, 0.97, 1.0), uDepthTint);
  gl_FragColor = vec4(c, t.a * uOpacity);
}`

/* 河床：贴图 + 动态焦散（两组正弦干涉，比静态高光更像水面聚焦的光） */
const BED_VERT = `
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`

const BED_FRAG = `
uniform sampler2D uMap;
uniform float uTime, uRepeat, uCaustic, uFogDensity;
uniform vec3 uFogColor;
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vec3 c = texture2D(uMap, vUv * uRepeat).rgb;
  // 焦散：两个不同频率的波场相乘，缓慢漂移
  float a = sin((vPos.x * 1.9 + sin(vPos.z * 1.3 + uTime * 0.55) * 1.1) * 1.35 + uTime * 0.85);
  float b = sin((vPos.z * 2.2 - sin(vPos.x * 1.6 + uTime * 0.42) * 1.2) * 1.25 - uTime * 0.65);
  float caust = smoothstep(0.55, 1.0, abs(a * b));
  c += caust * uCaustic * vec3(0.55, 0.90, 1.0);
  // 近处亮、远处沉进水色
  float d = length(vPos.xz - vec2(0.0, 2.2));
  float fog = clamp(1.0 - exp(-uFogDensity * uFogDensity * d * d * 1.6), 0.0, 0.85);
  c = mix(c * 0.78, uFogColor, fog);
  gl_FragColor = vec4(c, 1.0);
}`

const PLANT_FRAG = `
uniform sampler2D uMap;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec2 vUv;
varying float vDepth;
void main() {
  vec4 t = texture2D(uMap, vUv);
  if (t.a < 0.06) discard;
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  vec3 c = mix(t.rgb, uFogColor, clamp(f, 0.0, 0.9));
  gl_FragColor = vec4(c, t.a);
}`

const PLANT_VERT = `
uniform float uTime, uPhase, uSway;
varying vec2 vUv;
varying float vDepth;
void main() {
  vUv = uv;
  vec3 p = position;
  float up = clamp(uv.y, 0.0, 1.0);
  p.x += sin(uTime * 1.1 + uPhase) * uSway * up * up;
  p.z += cos(uTime * 0.8 + uPhase * 1.7) * uSway * 0.35 * up * up;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`

/**
 * 建场景。返回的对象：
 *   setFishes(list)    list: [{ id, zh, color, layer }]（最多 12 条）
 *   setPerf(on)        性能优先：降到 1x DPR、关光柱
 *   resize()           尺寸变化后调用（内部也有 ResizeObserver）
 *   start()/stop()     跑帧/停帧
 *   dispose()          卸载（释放 GPU 资源）
 */
export async function createAqua3D(canvas, opts = {}) {
  const T = await loadThree()

  /* ---------- 能力检查：没有 WebGL 就不要往下走，交给 2D ---------- */
  const probe = document.createElement('canvas')
  const gl = probe.getContext('webgl2') || probe.getContext('webgl')
  if (!gl) return null

  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1))
  renderer.outputColorSpace = T.SRGBColorSpace
  renderer.toneMapping = T.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  const scene = new T.Scene()
  const fogColor = new T.Color(0x10465c)
  scene.background = fogColor.clone()
  scene.fog = new T.FogExp2(fogColor.getHex(), 0.062)

  const camera = new T.PerspectiveCamera(44, 1, 0.1, 60)
  camera.position.set(0, 1.05, 3.55)

  /* ---------- 灯光：顶光 + 环境，河床靠方向光吃饭 ---------- */
  scene.add(new T.HemisphereLight(0x9fe6ff, 0x06202c, 1.15))
  const sun = new T.DirectionalLight(0xd8f6ff, 1.15)
  sun.position.set(-1.6, 5, 1.4)
  scene.add(sun)

  const fogUniform = { value: 0.062 }

  /* ---------- 河床 ---------- */
  const bedTex = new T.TextureLoader().load(bedUrl)
  bedTex.wrapS = bedTex.wrapT = T.RepeatWrapping
  if ('colorSpace' in bedTex) bedTex.colorSpace = T.SRGBColorSpace
  const bedUniforms = {
    uMap: { value: bedTex },
    uTime: { value: 0 },
    uRepeat: { value: 6.5 },
    uCaustic: { value: 0.34 },
    uFogColor: { value: fogColor },
    uFogDensity: fogUniform
  }
  const bed = new T.Mesh(
    new T.PlaneGeometry(70, 70, 1, 1),
    new T.ShaderMaterial({ uniforms: bedUniforms, vertexShader: BED_VERT, fragmentShader: BED_FRAG })
  )
  bed.rotation.x = -Math.PI / 2
  bed.position.set(0, BED_Y, -6)
  scene.add(bed)

  /* ---------- 水柱背景：包住整个场景的圆柱，纵向渐变（上亮下深）+ 微弱竖向流纹
     没有它的话，河床平面在「地平线」处会留一条硬边，上面直接是纯色的背景，一眼假。 ---------- */
  const colMat = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, transparent: false,
    uniforms: { uTime: { value: 0 }, uTop: { value: new T.Color(0x2f7f97) }, uBottom: { value: new T.Color(0x06222e) } },
    vertexShader: 'varying vec2 vUv; varying vec3 vPos; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position,1.0); vPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
    fragmentShader: `
      uniform float uTime; uniform vec3 uTop, uBottom;
      varying vec2 vUv; varying vec3 vPos;
      void main() {
        float h = clamp(vPos.y / 9.0 + 0.25, 0.0, 1.0);
        vec3 c = mix(uBottom, uTop, pow(h, 0.85));
        // 竖向流纹：两组缓慢移动的正弦，很淡
        float s = sin(vPos.x * 0.7 + uTime * 0.25) * sin(vPos.z * 0.55 - uTime * 0.18);
        c += s * 0.015;
        gl_FragColor = vec4(c, 1.0);
      }`
  })
  const column = new T.Mesh(new T.CylinderGeometry(34, 34, 26, 24, 1, true), colMat)
  column.position.set(0, 6, -6)
  scene.add(column)
  scene.background = null
  /* ---------- 光柱：几片加色混合的斜面，缓慢明暗 ---------- */
  const shaftTex = canvasTex(T, 64, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h)
    grd.addColorStop(0, 'rgba(190,245,255,0.55)')
    grd.addColorStop(0.55, 'rgba(150,225,255,0.16)')
    grd.addColorStop(1, 'rgba(120,200,240,0)')
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
  const shaftMat = new T.MeshBasicMaterial({
    map: shaftTex, transparent: true, opacity: 0.55, depthWrite: false,
    blending: T.AdditiveBlending, side: T.DoubleSide
  })
  const shaftGeo = new T.PlaneGeometry(1.5, 6.2)
  const shaftCount = 7
  for (let i = 0; i < shaftCount; i++) {
    const m = new T.Mesh(shaftGeo, shaftMat.clone())
    const x = (i / (shaftCount - 1) - 0.5) * 9 + (Math.random() - 0.5) * 0.6
    m.position.set(x, WATER_TOP - 2.6, -2.6 - Math.random() * 2.4)
    m.rotation.set(0.16 + Math.random() * 0.1, Math.random() * 0.6 - 0.3, 0.2 + Math.random() * 0.18)
    m.material.opacity = 0.18 + Math.random() * 0.22
    m.userData.phase = Math.random() * Math.PI * 2
    shafts.add(m)
  }
  scene.add(shafts)

  /* ---------- 水面（从水下往上看的那层亮带） ---------- */
  const surfMat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform float uTime; varying vec2 vUv;
      void main() {
        float w1 = sin(vUv.x * 13.0 + uTime * 0.9) * 0.5 + 0.5;
        float w2 = sin(vUv.y * 9.0 - uTime * 0.7 + w1 * 2.2) * 0.5 + 0.5;
        float a = pow(w1 * w2, 2.6) * 0.55 + 0.06;
        vec3 c = mix(vec3(0.35, 0.72, 0.88), vec3(0.92, 0.99, 1.0), a);
        gl_FragColor = vec4(c, a);
      }`
  })
  const surface = new T.Mesh(new T.PlaneGeometry(24, 14), surfMat)
  surface.rotation.x = Math.PI / 2
  surface.position.set(0, WATER_TOP, -3)
  scene.add(surface)

  /* ---------- 细草：窄叶片，顶点着色器摆动 ---------- */
  const plantTex = canvasTex(T, 32, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h)
    for (let i = 0; i < 3; i++) {
      const x = 6 + i * 9 + Math.random() * 3
      const grd = g.createLinearGradient(0, h, 0, 0)
      grd.addColorStop(0, 'rgba(30,86,64,0.95)')
      grd.addColorStop(1, 'rgba(96,176,120,0.75)')
      g.strokeStyle = grd
      g.lineWidth = 3.2
      g.beginPath()
      g.moveTo(x, h)
      g.quadraticCurveTo(x + (i - 1) * 10, h * 0.55, x + (i - 1) * 18, h * 0.08)
      g.stroke()
    }
  })
  const plants = new T.Group()
  const plantGeo = new T.PlaneGeometry(0.5, 1)
  for (let i = 0; i < 16; i++) {
    const hgt = 0.5 + Math.random() * 0.75
    const mat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, side: T.DoubleSide,
      uniforms: {
        uMap: { value: plantTex },
        uTime: { value: 0 },
        uPhase: { value: Math.random() * 6.28 },
        uSway: { value: 0.12 + Math.random() * 0.1 },
        uFogColor: { value: fogColor },
        uFogDensity: fogUniform
      },
      vertexShader: PLANT_VERT, fragmentShader: PLANT_FRAG
    })
    const m = new T.Mesh(plantGeo, mat)
    m.scale.set(0.8 + Math.random() * 0.6, hgt, 1)
    m.position.set((Math.random() - 0.5) * 9.5, BED_Y + hgt / 2, -1 - Math.random() * 5)
    plants.add(m)
  }
  scene.add(plants)

  /* ---------- 气泡 ---------- */
  const bubbleTex = canvasTex(T, 64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w * 0.4, h * 0.35, 1, w / 2, h / 2, w / 2)
    grd.addColorStop(0, 'rgba(255,255,255,0.95)')
    grd.addColorStop(0.55, 'rgba(200,240,255,0.35)')
    grd.addColorStop(1, 'rgba(180,230,255,0)')
    g.fillStyle = grd
    g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, 6.2832); g.fill()
  })
  const bubbleCount = 90
  const bPos = new Float32Array(bubbleCount * 3)
  const bSpeed = new Float32Array(bubbleCount)
  const bSize = new Float32Array(bubbleCount)
  for (let i = 0; i < bubbleCount; i++) {
    bPos[i * 3] = (Math.random() - 0.5) * 10
    bPos[i * 3 + 1] = Math.random() * WATER_TOP
    bPos[i * 3 + 2] = -Math.random() * 7
    bSpeed[i] = 0.10 + Math.random() * 0.26
    bSize[i] = 0.03 + Math.random() * 0.05
  }
  const bubbleGeo = new T.BufferGeometry()
  bubbleGeo.setAttribute('position', new T.BufferAttribute(bPos, 3))
  bubbleGeo.setAttribute('aSize', new T.BufferAttribute(bSize, 1))
  const bubbleMat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    uniforms: { uMap: { value: bubbleTex }, uOpacity: { value: 0.6 } },
    vertexShader: `
      attribute float aSize; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vA = clamp(1.0 - (-mv.z) / 16.0, 0.0, 1.0);
        gl_PointSize = aSize * 900.0 / max(0.2, -mv.z);
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

  /* ---------- 鱼 ---------- */
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
  }

  function setFishes(list) {
    clearFishes()
    const items = (list || []).slice(0, MAX_FISH)
    items.forEach((sp, i) => {
      const aspect = 0.40 // 贴图大致 512×206
      const geo = new T.PlaneGeometry(1, aspect, 28, 4)
      const mat = new T.ShaderMaterial({
        transparent: true, side: T.DoubleSide, depthWrite: false,
        uniforms: {
          uMap: { value: fishTex(sp.id) },
          uTime: { value: 0 },
          uSpeed: { value: 2.2 + Math.random() * 1.1 },
          uPhase: { value: Math.random() * 6.283 },
          uWiggle: { value: 0.055 + Math.random() * 0.03 },
          uOpacity: { value: 0.96 },
          uFogColor: { value: fogColor },
          uFogDensity: fogUniform,
          uDepthTint: { value: 0.25 }
        },
        vertexShader: FISH_VERT, fragmentShader: FISH_FRAG
      })
      const mesh = new T.Mesh(geo, mat)
      const isBot = sp.layer === 'bot' || (typeof sp.layer === 'string' && sp.layer.indexOf('bot') >= 0)
      const isTop = sp.layer === 'top'
      const yBase = isBot ? LAYER_Y.bot : (isTop ? LAYER_Y.top : LAYER_Y.mid)
      const scale = 0.8 + Math.random() * 0.55
      fishGroup.add(mesh)
      fishes.push({
        mesh, mat, sp,
        // 椭圆巡游：半径、速度、相位、朝向随机（同缸里不会整齐划一）
        rx: 1.1 + Math.random() * 1.9,
        rz: 0.7 + Math.random() * 1.5,
        y: yBase + (Math.random() - 0.5) * 0.16,
        cy: yBase,
        speed: (0.16 + Math.random() * 0.16) * (i % 2 ? 1 : -1),
        phase: Math.random() * 6.283,
        scale,
        bobAmp: isBot ? 0.03 : 0.07
      })
    })
  }

  /* ---------- 尺寸 ---------- */
  function resize() {
    const w = Math.max(1, canvas.clientWidth)
    const h = Math.max(1, canvas.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null
  if (ro) ro.observe(canvas)
  resize()

  /* ---------- 跑帧 ---------- */
  let raf = 0
  let running = false
  let perf = !!opts.perf
  const t0 = performance.now()
  let last = 0

  function applyPerf() {
    renderer.setPixelRatio(perf ? 1 : Math.min(1.5, window.devicePixelRatio || 1))
    shafts.visible = !perf
    bubbles.visible = !perf
    bedUniforms.uCaustic.value = perf ? 0.18 : 0.34
    resize()
  }
  applyPerf()

  function frame(now) {
    if (!running) return
    raf = requestAnimationFrame(frame)
    const t = (now - t0) / 1000
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
    last = now

    // 相机轻微漂移：像人贴着水底慢慢看
    camera.position.x = Math.sin(t * 0.075) * 0.28
    camera.position.y = 1.0 + Math.sin(t * 0.052) * 0.06
    camera.lookAt(0, 0.62, -1.4)

    bedUniforms.uTime.value = t
    surfMat.uniforms.uTime.value = t
    colMat.uniforms.uTime.value = t

    shafts.children.forEach((m, i) => {
      m.material.opacity = (0.14 + Math.random() * 0.02) + Math.sin(t * 0.6 + m.userData.phase) * 0.10
      m.rotation.z = 0.18 + Math.sin(t * 0.22 + i) * 0.05
    })
    plants.children.forEach((m) => { m.material.uniforms.uTime.value = t })

    if (!perf) {
      const pos = bubbleGeo.getAttribute('position')
      for (let i = 0; i < bubbleCount; i++) {
        let y = pos.array[i * 3 + 1] + bSpeed[i] * dt
        if (y > WATER_TOP) { y = 0.02; pos.array[i * 3] = (Math.random() - 0.5) * 10 }
        pos.array[i * 3 + 1] = y
        pos.array[i * 3] += Math.sin(t * 0.9 + i) * 0.0016
      }
      pos.needsUpdate = true
    }

    // 鱼：绕椭圆游 + 头朝切线方向 + 按距离轻微缩放（近大远小由透视给，这里只补一点）
    fishes.forEach((f) => {
      const a = f.phase + t * f.speed
      const x = Math.cos(a) * f.rx
      const z = Math.sin(a) * f.rz - 1.3
      const y = f.y + Math.sin(t * 0.9 + f.phase) * f.bobAmp
      f.mesh.position.set(x, y, z)
      // 朝向：切线 (dx, dz) → 让贴图右侧（鱼头）指向前进方向
      const dx = -Math.sin(a) * f.rx * Math.sign(f.speed)
      const dz = Math.cos(a) * f.rz * Math.sign(f.speed)
      // 面向相机（billboard，只绕 Y 转，鱼身保持竖直），再按「屏幕内的水平速度」翻转鱼头朝向：
      // rotation.y = θ 时局部 +X 指向世界 (cosθ, 0, -sinθ)，把速度投影到它上面判断左游还是右游。
      const toCam = Math.atan2(camera.position.x - x, camera.position.z - z)
      const vLocalX = dx * Math.cos(toCam) - dz * Math.sin(toCam)
      f.mesh.rotation.set(0, toCam + (vLocalX >= 0 ? 0 : Math.PI), Math.sin(t * 0.6 + f.phase) * 0.04)
      const s = f.scale * (0.9 + 0.1 * Math.sin(t * 0.5 + f.phase))
      f.mesh.scale.set(s, s, s)
      f.mat.uniforms.uTime.value = t
      // 远处的鱼淡一点，避免一条大鱼糊在镜头上
      const depth = Math.abs(z + 1.3)
      f.mat.uniforms.uOpacity.value = 0.92
      f.mat.uniforms.uDepthTint.value = Math.min(0.5, depth * 0.06)
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
