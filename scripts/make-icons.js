// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Draws the Najwa AI icon and writes the desktop icon, the website logos, and
// the Android and iOS launcher icons and splash screens.
//
// The icon is the Arabic letter noon (ن), the first letter of Najwa (نجوى, "a
// private conversation"): a white bowl, like cupped hands holding a secret,
// under a gold dot, a star in a night sky.
// Pure Node, no image libraries needed.
//
//   node scripts/make-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const NIGHT_TOP = [27, 24, 72];
const NIGHT_BOTTOM = [88, 64, 200];
const WHITE = [248, 246, 255];
const GOLD = [255, 198, 88];

// ---- shapes in a 512×512 design space ----------------------------------------

function inRounded(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// The bowl of the noon, drawn like a reed pen stroke: between two circles,
// the inner one higher, so it is thick at the bottom and thin at the tips,
// which rise a little above the middle and end round.
const OUTER = { x: 256, y: 241, r: 150 };
const INNER = { x: 256, y: 216, r: 126 };
const TIP_Y = 216;
const halfWidth = (c, y) => Math.sqrt(Math.max(0, c.r ** 2 - (y - c.y) ** 2));
const TIP = {
  x: (halfWidth(OUTER, TIP_Y) + halfWidth(INNER, TIP_Y)) / 2,
  r: (halfWidth(OUTER, TIP_Y) - halfWidth(INNER, TIP_Y)) / 2
};
function inBowl(x, y) {
  const inOuter = (x - OUTER.x) ** 2 + (y - OUTER.y) ** 2 <= OUTER.r ** 2;
  const inInner = (x - INNER.x) ** 2 + (y - INNER.y) ** 2 <= INNER.r ** 2;
  if (y >= TIP_Y && inOuter && !inInner) return true;
  return (Math.abs(x - 256) - TIP.x) ** 2 + (y - TIP_Y) ** 2 <= TIP.r ** 2;
}

// The dot: a diamond, as the noon's dot is written in calligraphy, and a gold
// star, with a soft glow around it.
const DOT = { x: 256, y: 156, w: 34, h: 46 };
const inDot = (x, y) => Math.abs(x - DOT.x) / DOT.w + Math.abs(y - DOT.y) / DOT.h <= 1;
const glow = (x, y) => 0.55 * Math.max(0, 1 - Math.hypot(x - DOT.x, y - DOT.y) / 115) ** 2;

const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);

/**
 * Render an image.
 * @param {number} w, h        output size in pixels
 * @param {object} o
 *   o.iconSize   pixel size of the 512-unit design space (centred)
 *   o.background 'rounded' | 'circle' | 'fill' | 'none'
 */
function render(w, h, o) {
  const px = Buffer.alloc(w * h * 4);
  const SS = 3;
  const scale = 512 / o.iconSize;
  const ox = (w - o.iconSize) / 2;
  const oy = (h - o.iconSize) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let bg = 0;
      let bowl = 0;
      let dot = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS - ox) * scale;
          const v = (y + (sy + 0.5) / SS - oy) * scale;
          if (o.background === 'fill') bg++;
          else if (o.background === 'rounded' && inRounded(u, v, 16, 16, 496, 496, 110)) bg++;
          else if (o.background === 'circle' && (u - 256) ** 2 + (v - 256) ** 2 <= 250 ** 2) bg++;
          if (inBowl(u, v)) bowl++;
          if (inDot(u, v)) dot++;
        }
      }
      const n = SS * SS;
      const [a, b, d] = [bg / n, bowl / n, dot / n];
      // Night sky, the star's glow on it, the white bowl, the gold dot.
      let c = mix(NIGHT_TOP, NIGHT_BOTTOM, y / h);
      c = mix(c, GOLD, glow((x + 0.5 - ox) * scale, (y + 0.5 - oy) * scale) * a);
      let alpha = a;
      c = mix(c, WHITE, b);
      alpha = alpha + b * (1 - alpha);
      c = mix(c, GOLD, d);
      alpha = alpha + d * (1 - alpha);
      const i = (y * w + x) * 4;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(w, h, px, { opaque: o.opaque });
}

// ---- minimal PNG encoder / size reader --------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}

// RGBA, or RGB with `opaque` (the App Store rejects app icons that have an
// alpha channel).
function encodePng(w, h, px, { opaque = false } = {}) {
  const ch = opaque ? 3 : 4;
  const raw = Buffer.alloc(h * (w * ch + 1));
  for (let y = 0; y < h; y++) {
    if (!opaque) {
      px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
      continue;
    }
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const i = (y * w + x) * 4;
      raw[o] = px[i];
      raw[o + 1] = px[i + 1];
      raw[o + 2] = px[i + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log('wrote', path.relative(root, file));
}

// ---- outputs ---------------------------------------------------------------

write(path.join(root, 'build/icon.png'), render(512, 512, { iconSize: 512, background: 'rounded' }));

// Website: the logo for Google's sign-in screen (square, 120×120, full
// background so it looks right when Google rounds it) and the page icon.
write(path.join(root, 'site/logo-120.png'), render(120, 120, { iconSize: 120, background: 'fill' }));
write(path.join(root, 'site/icon.png'), render(192, 192, { iconSize: 192, background: 'rounded' }));

const res = path.join(root, 'android/app/src/main/res');
if (fs.existsSync(res)) {
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(densities)) {
    const legacy = Math.round(48 * k);
    write(`${res}/mipmap-${d}/ic_launcher.png`, render(legacy, legacy, { iconSize: legacy, background: 'rounded' }));
    write(`${res}/mipmap-${d}/ic_launcher_round.png`, render(legacy, legacy, { iconSize: legacy, background: 'circle' }));
    // Adaptive icon foreground: 108dp canvas, artwork inside the 66dp safe zone.
    const fg = Math.round(108 * k);
    write(`${res}/mipmap-${d}/ic_launcher_foreground.png`, render(fg, fg, { iconSize: Math.round(80 * k), background: 'none' }));
  }
  // Splash screens: the night sky with the icon in the middle.
  for (const dir of fs.readdirSync(res)) {
    const file = path.join(res, dir, 'splash.png');
    if (!fs.existsSync(file)) continue;
    const [w, h] = pngSize(file);
    write(file, render(w, h, { iconSize: Math.round(Math.min(w, h) * 0.45), background: 'fill' }));
  }
  write(`${res}/values/ic_launcher_background.xml`,
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#392C88</color>\n</resources>\n');
}

// iOS: one 1024×1024 app icon (iOS rounds the corners itself, so the
// background fills the square) and the launch screen images.
const ios = path.join(root, 'ios/App/App/Assets.xcassets');
if (fs.existsSync(ios)) {
  write(`${ios}/AppIcon.appiconset/AppIcon-512@2x.png`, render(1024, 1024, { iconSize: 1024, background: 'fill', opaque: true }));
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    const file = `${ios}/Splash.imageset/${name}`;
    if (fs.existsSync(file)) write(file, render(2732, 2732, { iconSize: 900, background: 'fill', opaque: true }));
  }
}
