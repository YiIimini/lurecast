import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

/* 重构期（P0–P1）说明：
   · 线上/APK 现在仍用根目录 index.html + assets/*.js（手写 IIFE），本配置暂不接管它；
   · P0 只把 TS 管线跑通：lib 模式把 src/lib/engine.ts 编译成 dist-web/engine.js；
   · P1 改成整包构建（入口 src/main.ts + 新的 index.html），届时 native/www 指向 dist-web；
   · Leaflet 已本地自托管（assets/vendor/leaflet），不再依赖 CDN。 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL('./src/lib/engine.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'engine.js'
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: 'default'
  }
})
