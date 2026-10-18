/* 把 Web 应用装进 www/（P4：新壳接管 index.html）
   ---------------------------------------------------------------------------
   用法：npm run sync-web（package.json 里已带 build），然后 `npx cap sync android` 出包。
   做的事情：
     1. 清空 www/，拷 dist-web/*（Vite 产物：入口名是 app.html，资源带 hash）；
     2. app.html → index.html（Capacitor 只认 index.html）；
     3. 拷 icons/（跳过设计源图 icons/source/）与 manifest.webmanifest；
     4. 拷新的 sw.js（清单自动生成，不再手写）；
     5. 顺手清空 Android 的 assets/public —— Capacitor 的 copy 不清旧文件，
        加过一次 hash 变了的资源就会一直叠在包里（实测叠出过 1 MB 死重量）。
   老壳（根 index.html + assets/*.js）默认不装；要手机上能回滚就加 --with-legacy。 */
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const root = path.resolve(here, '..');
const dist = path.join(root, 'dist-web');
const dst = path.resolve(here, 'www');

if (!fs.existsSync(path.join(dist, 'app.html'))) {
  console.error('找不到 dist-web/app.html —— 先跑 npm run build');
  process.exit(1);
}

fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });

/* 1) 新壳：Vite 产物整体进来 */
fs.cpSync(dist, dst, { recursive: true });
fs.renameSync(path.join(dst, 'app.html'), path.join(dst, 'index.html'));

/* 2) 图标与 manifest（新图标来自 icons/，老壳没有也能跑）。
   icons/source/ 是设计源图（1024 预览、圆角/圆形预览，共 ~0.57 MB），运行时不引用，
   装进包里纯占地方，所以跳过。 */
const iconsFrom = path.join(root, 'icons')
if (fs.existsSync(iconsFrom)) {
  fs.cpSync(iconsFrom, path.join(dst, 'icons'), {
    recursive: true, force: true,
    filter: (src) => path.basename(src) !== 'source'
  })
}
const manifestFrom = path.join(root, 'manifest.webmanifest')
if (fs.existsSync(manifestFrom)) fs.copyFileSync(manifestFrom, path.join(dst, 'manifest.webmanifest'))

/* 3) 老壳回滚入口：默认不装（www 从 3.64 → 1.66 MB；但 APK 只从 6.90 → 6.77 MB，
   因为体积大头在 Android 侧的 classes.dex，不是 web 资源，别指望删老壳能瘦到 4 MB）。
   要带老壳（手机上能一键回滚）就 `node native/sync-web.mjs --with-legacy`。
   老壳源码一直在仓库根目录，网页版随时能开，不装进包里也不会丢。 */
const withLegacy = process.argv.includes('--with-legacy');
if (withLegacy) {
  const legacySrc = path.join(root, 'index.html');
  if (fs.existsSync(legacySrc)) fs.copyFileSync(legacySrc, path.join(dst, 'legacy.html'));
  const from = path.join(root, 'assets');
  if (fs.existsSync(from)) fs.cpSync(from, path.join(dst, 'assets'), { recursive: true, force: true });
}

/* 4) 新 SW */
fs.copyFileSync(path.join(root, 'sw.js'), path.join(dst, 'sw.js'));

/* 5) 清空 Android 侧的 assets/public：Capacitor 的 copy 只覆盖不删除，
   旧 hash 资源会一直叠在包里（实测叠出约 1 MB）。下一步 cap sync 会重新拷一份。 */
const androidAssets = path.join(root, 'native/android/app/src/main/assets/public');
if (fs.existsSync(androidAssets)) fs.rmSync(androidAssets, { recursive: true, force: true });

/* 6) 汇总体积，方便盯预算 */
function sizeOf(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return st.size;
  return fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0);
}
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
console.log('已同步到 www/');
for (const item of ['index.html', 'legacy.html', 'assets', 'icons', 'sw.js']) {
  const p = path.join(dst, item);
  if (fs.existsSync(p)) console.log('  ' + item + '  ' + mb(sizeOf(p)));
}
console.log('  老壳回滚包: ' + (withLegacy ? '已包含（legacy.html + assets/）' : '未包含（要的话加 --with-legacy）'));
console.log('  www 合计 ' + mb(sizeOf(dst)));
