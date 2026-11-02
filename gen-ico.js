// 生成应用图标 assets/app.ico（橙底圆角方块 + 深色 "5E"）
const fs = require('fs');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(W, H, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(H * (W * 4 + 1));
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// 5x7 点阵
const GLYPH = {
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111']
};

function draw(S) {
  const buf = Buffer.alloc(S * S * 4);
  const pad = Math.round(S * 0.05);
  const r = Math.round(S * 0.24);
  const x0 = pad, y0 = pad, x1 = S - pad, y1 = S - pad;

  const inRound = (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r || (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r);
  };

  // 字母布局：11 格宽（5 + 1 间隙 + 5），7 格高
  const cell = Math.max(1, Math.floor((S * 0.60) / 11));
  const gw = cell * 11, gh = cell * 7;
  const gx = Math.round((S - gw) / 2), gy = Math.round((S - gh) / 2);

  const inLetter = (x, y) => {
    const lx = Math.floor((x - gx) / cell), ly = Math.floor((y - gy) / cell);
    if (lx < 0 || lx > 10 || ly < 0 || ly > 6) return false;
    if (lx < 5) return GLYPH['5'][ly][lx] === '1';
    if (lx === 5) return false;
    return GLYPH['E'][ly][lx - 6] === '1';
  };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (!inRound(x, y)) { buf[i + 3] = 0; continue; }
      if (inLetter(x, y)) { buf[i] = 22; buf[i + 1] = 23; buf[i + 2] = 31; }
      else { buf[i] = 255; buf[i + 1] = 159; buf[i + 2] = 67; }
      buf[i + 3] = 255;
    }
  }
  return buf;
}

const sizes = [256, 64, 48, 32, 16];
const pngs = sizes.map((s) => ({ s, data: encodePNG(s, s, draw(s)) }));

// ICO 容器
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);

const dirs = [];
let offset = 6 + pngs.length * 16;
for (const p of pngs) {
  const d = Buffer.alloc(16);
  d[0] = p.s >= 256 ? 0 : p.s;
  d[1] = p.s >= 256 ? 0 : p.s;
  d[2] = 0; d[3] = 0;
  d.writeUInt16LE(1, 4);
  d.writeUInt16LE(32, 6);
  d.writeUInt32LE(p.data.length, 8);
  d.writeUInt32LE(offset, 12);
  offset += p.data.length;
  dirs.push(d);
}

const ico = Buffer.concat([header, ...dirs, ...pngs.map((p) => p.data)]);
fs.writeFileSync(__dirname + '/assets/app.ico', ico);

// 顺手存一张 256 的 png 备用
fs.writeFileSync(__dirname + '/assets/app.png', pngs[0].data);
console.log('app.ico', ico.length, 'bytes');
