// @ts-nocheck
/* LureCast · Deeper 声呐 CSV 解析（P4）—— 按 docs/DEEPER-SONAR.md 与实测样本对齐
   -----------------------------------------------------------------------------------
   真实导出有两种：
     · Quest/PRO 的 bathymetry.csv：**无表头**，4 列（旧固件）或 5 列（含温度），
       列序 timestamp,lat,lon,depth[,temp]；
     · 手机 App 的 scan_data_*.csv：**有表头**，Deeper 把 longitude 拼成了 `longtitude`（两个都认），
       GPS 约 1 Hz、深度约 15 Hz，所以坐标列大量为空（空白 ≠ 脏行）。
   几个必须按实测处理的坑：
     · 温度 0.0 是「无读数」哨兵，> 40℃ 是出水暴晒，都不能当真实水温；
     · 空白单元格要单独判（Number('') === 0 会伪装成「无定位」行）；
     · 脏行比例只在 ≥100 行时判（短扫描别被一行脏数据拒掉）；残包 <2 行直接报 STUB_FILE；
     · 深度加换能器吃水（默认 0.15 m），否则每条都浅一点。
   纯函数、零依赖、可在 node 跑测试（见 __tests__/deeper.test.ts）。 */
  var MAX_TEMP = 40;             // 出水暴晒会读到 45+；0.0 是「无读数」哨兵
  var MALFORMED_MAX = 0.01;      // 脏行比例上限
  var MALFORMED_MIN_ROWS = 100;  // 少于 100 行不做比例判定（短扫描别被一行脏数据拒掉）
  var STUB_MIN_ROWS = 2;

  function plausibleTemp(v) {
    return (isFinite(v) && v > 0 && v <= MAX_TEMP) ? v : null;
  }
  function err(code, extra) {
    var e = { code: code };
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }

  // 手机端表头：Deeper 自己把 longitude 拼成了 longtitude，两个都认
  function headerIndex(cells) {
    var cols = cells.map(function (c) { return c.trim().toLowerCase(); });
    var at = function (names) {
      for (var i = 0; i < names.length; i++) {
        var j = cols.indexOf(names[i]);
        if (j >= 0) return j;
      }
      return -1;
    };
    if (at(['latitude']) < 0 || at(['depth']) < 0 || at(['time']) < 0) return null;
    return {
      lat: at(['latitude']), lon: at(['longitude', 'longtitude']),
      depth: at(['depth']), temp: at(['temperature', 'water temperature', 'temp']),
      time: at(['time'])
    };
  }

  function parseText(text, opts) {
    opts = opts || {};
    var offset = opts.transducerOffsetM != null ? opts.transducerOffsetM : 0.15;
    var lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');

    var fixes = [], total = 0, skipped = 0, zeroGps = 0, hasGps = false;
    var idx = null, width = -1, hadHeader = false, probes = 0, lastCols = 0;

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!ln || ln.trim() === '') continue;
      var cells = ln.split(',');

      if (width < 0) {
        // 头几行用来定格式。前几行脏不等于「不是 Deeper」——真导出是整块数字，脏行只零星出现。
        probes++; lastCols = cells.length;
        var h = headerIndex(cells);
        if (h) {
          idx = h; width = cells.length; hadHeader = true;
          continue;
        }
        if (cells.length === 4 || cells.length === 5) {
          width = cells.length;
          idx = width === 5
            ? { lat: 0, lon: 1, depth: 2, temp: 3, time: 4 }
            : { lat: 0, lon: 1, depth: 2, temp: -1, time: 3 };
          // 不 continue：这行本身就是数据
        } else if (probes >= 20) {
          throw err('NOT_DEEPER', { cols: cells.length });
        } else {
          skipped++; continue;
        }
      }

      total++;
      if (cells.length !== width) { skipped++; continue; }

      // 空白单元格要判脏：Number('') === 0，会伪装成「无定位」行。
      // 例外是手机端导出的坐标列（GPS 约 1 Hz、深度约 15 Hz，坐标本来就有大量空值）。
      var bad = false;
      for (var c = 0; c < cells.length; c++) {
        if (cells[c].trim() === '' && !(c === idx.lat || c === idx.lon)) { bad = true; break; }
      }
      if (bad) { skipped++; continue; }

      var latS = cells[idx.lat].trim(), lonS = cells[idx.lon].trim();
      var lat = latS === '' ? 0 : Number(latS);
      var lon = lonS === '' ? 0 : Number(lonS);
      var depth = Number(cells[idx.depth]);
      var ts = Number(cells[idx.time]);
      if (!isFinite(lat) || !isFinite(lon) || !isFinite(depth) || !isFinite(ts)) { skipped++; continue; }
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { skipped++; continue; }

      var gpsOk = !(lat === 0 && lon === 0);
      if (gpsOk) hasGps = true; else zeroGps++;

      fixes.push({
        lat: lat, lon: lon,
        tMs: ts < 1e12 ? ts * 1000 : ts,          // 秒 → 毫秒
        depthM: +((depth + offset).toFixed(2)),   // 加上换能器吃水
        tempC: idx.temp >= 0 ? plausibleTemp(Number(cells[idx.temp])) : null,
        gpsOk: gpsOk
      });
    }

    if (width < 0) throw err(probes > 0 ? 'NOT_DEEPER' : 'NO_ROWS', { cols: lastCols });
    if (total === 0) throw err('NO_ROWS');
    if (total < STUB_MIN_ROWS) throw err('STUB_FILE', { rows: total });
    if (total >= MALFORMED_MIN_ROWS && skipped / total > MALFORMED_MAX) {
      throw err('MALFORMED', { ratio: skipped / total });
    }
    if (fixes.length > 0 && !hasGps) throw err('NO_GPS');

    return {
      fixes: fixes, rowsTotal: total, rowsSkipped: skipped, zeroGps: zeroGps,
      hadHeader: hadHeader, cols: width, depthOffsetM: offset
    };
  }

export const Deeper = { parseText: parseText, VERSION: '2' }
export default Deeper