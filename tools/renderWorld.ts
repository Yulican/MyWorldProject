// Dev tool: renders generated worlds to PNG files and prints stats, to check
// the generator without a phone.
//   npx tsx tools/renderWorld.ts <outDir> [seed ...] [--size=64]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  BIOMES,
  DEPOSITS,
  cellAtPoint,
  generateWorld,
  hexCenterX,
  hexCenterY,
  mapHeight,
  wrapWidth,
  type World,
} from '../src/sim';
import { BIOME_COLORS, DEPOSIT_COLORS } from '../src/map/palette';

const HEX_PX = 6;

function render(world: World): Buffer {
  const w = Math.round(wrapWidth(world) * HEX_PX);
  const h = Math.round(mapHeight(world) * HEX_PX);
  const rgb = Buffer.alloc(w * h * 3);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = px / HEX_PX;
      const y = py / HEX_PX;
      const c = cellAtPoint(world, x, y);
      if (c < 0) continue;
      const col = c % world.width;
      const row = (c - col) / world.width;
      let dx = x - hexCenterX(col);
      if (dx > wrapWidth(world) / 2) dx -= wrapWidth(world);
      if (dx < -wrapWidth(world) / 2) dx += wrapWidth(world);
      const d = Math.hypot(dx, y - hexCenterY(col, row));
      let color = shade(BIOME_COLORS[world.biome[c]], world.elevation[c]);
      if (world.riverFlow[c] > 0 && d < 0.3) color = '#3f7fd0';
      if (world.deposit[c] && d < 0.25) color = DEPOSIT_COLORS[DEPOSITS[world.deposit[c]].category];
      if (c === world.startCell && d < 0.6) color = '#ff2030';
      const [r, g, b] = hex(color);
      const i = (py * w + px) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
    }
  }
  return encodePng(w, h, rgb);
}

function shade(color: string, e: number): string {
  const [r, g, b] = hex(color);
  const f = e >= 0 ? 1.1 - e * 0.35 : 1 + e * 0.25;
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `#${[to(r), to(g), to(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function hex(color: string): [number, number, number] {
  const v = parseInt(color.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function encodePng(w: number, h: number, rgb: Buffer): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function stats(world: World, ms: number): string {
  const counts = new Array(BIOMES.length).fill(0);
  let rivers = 0;
  let deposits = 0;
  for (let c = 0; c < world.cellCount; c++) {
    counts[world.biome[c]]++;
    if (world.riverFlow[c] > 0) rivers++;
    if (world.deposit[c]) deposits++;
  }
  const biomes = counts
    .map((n, i) => `${BIOMES[i].name} ${((n / world.cellCount) * 100).toFixed(1)}%`)
    .join(', ');
  const s = world.startCell;
  return `seed ${world.seed} (${world.shape}, ${ms.toFixed(1)} ms): ${biomes}; rivers ${rivers}, deposits ${deposits}, start ${s} = ${BIOMES[world.biome[s]]?.name} ${world.temperature[s]?.toFixed(0)}°C`;
}

const args = process.argv.slice(2);
const outDir = args[0] ?? 'world-previews';
const size = Number(args.find((a) => a.startsWith('--size='))?.slice(7) ?? 64);
const seeds = args.slice(1).filter((a) => !a.startsWith('--')).map(Number);
if (seeds.length === 0) seeds.push(1, 2, 3, 4);
mkdirSync(outDir, { recursive: true });
for (const seed of seeds) {
  const t0 = performance.now();
  const world = generateWorld({ seed, width: size, height: size });
  const ms = performance.now() - t0;
  writeFileSync(join(outDir, `world-${seed}.png`), render(world));
  console.log(stats(world, ms));
}
