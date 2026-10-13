/**
 * make_icons.js —— 生成插件图标 PNG，零依赖
 *
 * 图案：深色圆角方底 + 中间一道荧光绿的「盾/闪电」折线（Spectre 的 S），
 * 尺寸 16/32/48/128 各出一份，带抗锯齿。
 *
 * 用法：node tools/make_icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ------------------------------------------------------------------ PNG 编码

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array，长度 w*h*4 */
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4)
      .copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filter
  ihdr[12] = 0;  // no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ 造型

/** 圆角矩形覆盖度（用 4x4 超采样做抗锯齿） */
function coverage(px, py, x, y, w, h, r) {
  const cx = x + w / 2, cy = y + h / 2;
  const dx = Math.max(Math.abs(px - cx) - (w / 2 - r), 0);
  const dy = Math.max(Math.abs(py - cy) - (h / 2 - r), 0);
  // 到「内缩矩形」的距离：<=r 在圆角内
  return Math.sqrt(dx * dx + dy * dy) <= r ? 1 : 0;
}

function aa(x, y, x0, y0, w, h, r) {
  const SS = 4;
  let acc = 0;
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      acc += coverage(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, x0, y0, w, h, r);
    }
  }
  return acc / (SS * SS);
}

/** 到线段的距离（用于画折线）。 */
function distToSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 === 0 ? 0 : (wx * vx + wy * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + t * vx), dy = py - (ay + t * vy);
  return Math.sqrt(dx * dx + dy * dy);
}

/** 画一个 S 形折线覆盖度（带超采样）。 */
function strokeCoverage(px, py, pts, halfWidth) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    d = Math.min(d, distToSeg(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  }
  return d <= halfWidth ? 1 : 0;
}

function aaStroke(x, y, pts, halfWidth) {
  const SS = 4;
  let acc = 0;
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      acc += strokeCoverage(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, pts, halfWidth);
    }
  }
  return acc / (SS * SS);
}

const BG = [17, 20, 24];        // #111418
const BG2 = [26, 32, 38];       // 微渐变
const MARK = [0x4A, 0xE0, 0x8A];   // #4AE08A

function renderIcon(size) {
  const rgba = new Uint8Array(size * size * 4);
  const r = size * 0.22;
  // S 形折线（归一化坐标 → 像素）
  const s = size;
  const pts = [
    [0.63, 0.24], [0.40, 0.41], [0.62, 0.52], [0.38, 0.76],
  ].map(p => [p[0] * s, p[1] * s]);
  const half = Math.max(size * 0.055, 0.9);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const body = aa(x, y, 0, 0, size, size, r);
      if (body <= 0) continue;
      // 背景轻微纵向渐变
      const t = y / Math.max(size - 1, 1);
      const base = [
        Math.round(BG[0] + (BG2[0] - BG[0]) * t),
        Math.round(BG[1] + (BG2[1] - BG[1]) * t),
        Math.round(BG[2] + (BG2[2] - BG[2]) * t),
      ];
      const m = aaStroke(x, y, pts, half);
      const col = [
        Math.round(base[0] + (MARK[0] - base[0]) * m),
        Math.round(base[1] + (MARK[1] - base[1]) * m),
        Math.round(base[2] + (MARK[2] - base[2]) * m),
      ];
      rgba[i] = col[0];
      rgba[i + 1] = col[1];
      rgba[i + 2] = col[2];
      rgba[i + 3] = Math.round(255 * body);
    }
  }
  return encodePng(size, size, rgba);
}

// ------------------------------------------------------------------ main

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
[16, 32, 48, 128].forEach(function (size) {
  const png = renderIcon(size);
  const file = path.join(outDir, 'icon' + size + '.png');
  fs.writeFileSync(file, png);
  console.log('wrote ' + file + '  (' + png.length + ' bytes)');
});
