/* 把上一层的 Web 应用拷进 www/，避免维护两份源码。
   用法：npm run sync-web   （改完 index.html/assets 后一定要跑一次） */
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const src = path.resolve(here, '..');
const dst = path.resolve(here, 'www');
const ITEMS = ['index.html', 'assets', 'icons', 'manifest.webmanifest', 'sw.js'];
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
for (const item of ITEMS) {
  const from = path.join(src, item);
  if (!fs.existsSync(from)) continue;
  fs.cpSync(from, path.join(dst, item), { recursive: true });
}
console.log('已同步到 www/: ' + ITEMS.join(', '));
