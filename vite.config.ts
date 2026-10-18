import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
/* 重构期（P1）说明：
   · 新壳入口是 app.html（根 index.html 仍由老的手写 IIFE 驱动，两者并存用于对照）；
   · 构建产物到 dist-web/，等 P4 全量迁完再把 index.html 与 native/www 切过来；
   · Leaflet 已本地自托管（assets/vendor/leaflet）。 */
/* 水族馆的 25 张鱼贴图是运行期拼路径加载的（aqua.ts 里 'assets/fish/' + id + '.webp'），
   不是 import 进来的，Vite 默认不会搬。构建收尾手工复制一份，否则 APK 里全部 404，
   只能看到矢量的兜底画法。decor-* / scene.webp 新壳已弃用，bed-lake.webp 由 ?url 打进
   bundle，都不复制。 */
function copyFishSprites(): Plugin {
  return {
    name: 'lc-copy-fish-sprites',
    apply: 'build',
    closeBundle() {
      const from = fileURLToPath(new URL('./assets/fish', import.meta.url))
      const to = fileURLToPath(new URL('./dist-web/assets/fish', import.meta.url))
      mkdirSync(to, { recursive: true })
      let n = 0
      let bytes = 0
      for (const f of readdirSync(from)) {
        if (!f.endsWith('.webp')) continue
        if (f.startsWith('decor-') || f === 'scene.webp' || f === 'bed-lake.webp') continue
        const src = join(from, f)
        copyFileSync(src, join(to, f))
        n++
        bytes += statSync(src).size
      }
      console.log(`[fish] 复制 ${n} 张贴图 → dist-web/assets/fish（${Math.round(bytes / 1024)} KB）`)
    }
  }
}
export default defineConfig({
  plugins: [vue(), copyFishSprites()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      input: { app: fileURLToPath(new URL('./app.html', import.meta.url)) }
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: 'default'
  }
})
