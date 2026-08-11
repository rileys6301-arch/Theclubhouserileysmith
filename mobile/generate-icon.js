#!/usr/bin/env node
/**
 * Generates all PNG icon assets for The Circuit golf app.
 * No npm dependencies — only Node.js built-ins (zlib, fs, path).
 *
 * Usage:  node generate-icon.js
 * Output: assets/icon.png, adaptive-icon.png, splash-icon.png, favicon.png
 */
'use strict';

const fs   = require('fs');
const zlib = require('zlib');
const path = require('path');

// ─── CRC32 ───────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length);
  const t   = Buffer.from(type, 'ascii');
  const crc = Buffer.allocUnsafe(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

// ─── PNG builders ─────────────────────────────────────────────────────────────

function buildPng(rawData, w, h, colorType) {
  const compressed = zlib.deflateSync(rawData, { level: 9 });
  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = (() => {
    const d = Buffer.allocUnsafe(13);
    d.writeUInt32BE(w, 0); d.writeUInt32BE(h, 4);
    d[8] = 8; d[9] = colorType; d[10] = 0; d[11] = 0; d[12] = 0;
    return pngChunk('IHDR', d);
  })();
  return Buffer.concat([sig, ihdr, pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))]);
}

function makeRgbPng(pixels, w, h) {
  const rowLen = 1 + w * 3;
  const raw    = Buffer.allocUnsafe(h * rowLen);
  for (let y = 0; y < h; y++) {
    raw[y * rowLen] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 3, d = y * rowLen + 1 + x * 3;
      raw[d] = pixels[s]; raw[d+1] = pixels[s+1]; raw[d+2] = pixels[s+2];
    }
  }
  return buildPng(raw, w, h, 2);
}

function makeRgbaPng(pixels, w, h) {
  const rowLen = 1 + w * 4;
  const raw    = Buffer.allocUnsafe(h * rowLen);
  for (let y = 0; y < h; y++) {
    raw[y * rowLen] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = y * rowLen + 1 + x * 4;
      raw[d] = pixels[s]; raw[d+1] = pixels[s+1]; raw[d+2] = pixels[s+2]; raw[d+3] = pixels[s+3];
    }
  }
  return buildPng(raw, w, h, 6);
}

// ─── Geometry ─────────────────────────────────────────────────────────────────

function triSign(p1x,p1y, p2x,p2y, p3x,p3y) {
  return (p1x - p3x) * (p2y - p3y) - (p2x - p3x) * (p1y - p3y);
}
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = triSign(px,py, ax,ay, bx,by);
  const d2 = triSign(px,py, bx,by, cx,cy);
  const d3 = triSign(px,py, cx,cy, ax,ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

// ─── Flag geometry (pre-computed for one canvas size) ─────────────────────────
//
// Source SVG path (viewBox 24×24):
//   M6 2 v20          — staff: vertical line x=6, y=2 to y=22
//   M6 2 l12 5 -12 5  — flag: triangle (6,2)→(18,7)→(6,12)
//
// We scale the 24×24 design into a `designSize`×`designSize` box
// centred in the `canvasSize`×`canvasSize` canvas.

function precompute(canvasSize, designSize) {
  const S  = designSize / 24;
  const OX = (canvasSize - designSize) / 2;
  const OY = (canvasSize - designSize) / 2;

  const STAFF_W = Math.max(3, Math.round(S * 0.95));
  const sCX  = OX + 6 * S;                         // staff centre x
  const sX1  = Math.round(sCX - STAFF_W / 2);
  const sX2  = sX1 + STAFF_W;
  const sY1  = Math.round(OY + 2  * S);
  const sY2  = Math.round(OY + 22 * S);

  const fAX = Math.round(OX + 6  * S);
  const fAY = Math.round(OY + 2  * S);
  const fBX = Math.round(OX + 18 * S);
  const fBY = Math.round(OY + 7  * S);
  const fCX = Math.round(OX + 6  * S);
  const fCY = Math.round(OY + 12 * S);

  return { sX1, sX2, sY1, sY2, fAX, fAY, fBX, fBY, fCX, fCY };
}

function isIconPixel(px, py, geo) {
  const { sX1, sX2, sY1, sY2, fAX, fAY, fBX, fBY, fCX, fCY } = geo;
  if (px >= sX1 && px <= sX2 && py >= sY1 && py <= sY2) return true;
  return inTriangle(px, py, fAX, fAY, fBX, fBY, fCX, fCY);
}

// ─── Render functions ─────────────────────────────────────────────────────────

function renderRgb(size, designSize, bgR,bgG,bgB, fgR,fgG,fgB, label) {
  const geo     = precompute(size, designSize);
  const pixels  = Buffer.allocUnsafe(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      const fg = isIconPixel(x, y, geo);
      pixels[i]   = fg ? fgR : bgR;
      pixels[i+1] = fg ? fgG : bgG;
      pixels[i+2] = fg ? fgB : bgB;
    }
    if (y % 128 === 0) process.stdout.write(`\r  ${label}: ${Math.round(y / size * 100)}%  `);
  }
  process.stdout.write(`\r  ${label}: 100%  \n`);
  return makeRgbPng(pixels, size, size);
}

function renderRgba(size, designSize, bgR,bgG,bgB,bgA, fgR,fgG,fgB,fgA, label) {
  const geo     = precompute(size, designSize);
  const pixels  = Buffer.allocUnsafe(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const fg = isIconPixel(x, y, geo);
      pixels[i]   = fg ? fgR : bgR;
      pixels[i+1] = fg ? fgG : bgG;
      pixels[i+2] = fg ? fgB : bgB;
      pixels[i+3] = fg ? fgA : bgA;
    }
    if (y % 64 === 0) process.stdout.write(`\r  ${label}: ${Math.round(y / size * 100)}%  `);
  }
  process.stdout.write(`\r  ${label}: 100%  \n`);
  return makeRgbaPng(pixels, size, size);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const ASSETS = path.join(__dirname, 'assets');

// Brand colours
const DARK_G = [27, 46, 27];      // #1B2E1B  deep forest green background
const WHITE  = [255, 255, 255];   // white flag

console.log('Generating The Circuit icon assets…\n');

// icon.png — 1024×1024, dark green bg, white flag (iOS + default)
fs.writeFileSync(
  path.join(ASSETS, 'icon.png'),
  renderRgb(1024, 620, ...DARK_G, ...WHITE, 'icon.png')
);

// adaptive-icon.png — 1024×1024, transparent bg, white flag
// (app.json adaptiveIcon.backgroundColor = #1B2E1B gives the green bg on Android)
fs.writeFileSync(
  path.join(ASSETS, 'adaptive-icon.png'),
  renderRgba(1024, 440, 0, 0, 0, 0, ...WHITE, 255, 'adaptive-icon.png')
);

// splash-icon.png — 500×500, transparent bg, dark green flag (sits on white splash)
fs.writeFileSync(
  path.join(ASSETS, 'splash-icon.png'),
  renderRgba(500, 300, 0, 0, 0, 0, ...DARK_G, 255, 'splash-icon.png')
);

// favicon.png — 48×48, dark green bg, white flag
fs.writeFileSync(
  path.join(ASSETS, 'favicon.png'),
  renderRgb(48, 30, ...DARK_G, ...WHITE, 'favicon.png')
);

console.log('\nAll assets written to assets/');
