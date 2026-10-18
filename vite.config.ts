import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

/* 重构期（P1）说明：
   · 新壳入口是 app.html（根 index.html 仍由老的手写 IIFE 驱动，两者并存用于对照）；
   · 构建产物到 dist-web/，等 P4 全量迁完再把 index.html 与 native/www 切过来；
   · Leaflet 已本地自托管（assets/vendor/leaflet）。 */
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
