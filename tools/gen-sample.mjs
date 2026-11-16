/**
 * tools/gen-sample.mjs — deterministic scene corpus for oitcert.
 *
 * Usage: node tools/gen-sample.mjs
 * Writes data/scene.json (primary, dense random triangle soup) and
 * data/scene-layered.json (a small, deliberately stacked stack of quads, used
 * as a second corpus). Same command twice => byte-identical files (fixed seeds,
 * no Date/Math.random, values rounded to 6 decimals).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'data');

// mulberry32: tiny, deterministic, well-known PRNG.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r6 = (x) => Number(x.toFixed(6));

function randomSoup(seed, count, extent, spread, halfW, halfH) {
  const rnd = mulberry32(seed);
  const triangles = [];
  for (let i = 0; i < count; i++) {
    const cxp = (rnd() * 2 - 1) * extent;
    const cyp = (rnd() * 2 - 1) * extent;
    const czp = (rnd() * 2 - 1) * 0.8;
    const s = spread * (0.35 + 0.65 * rnd());
    const v = [];
    for (let k = 0; k < 3; k++) {
      v.push([
        r6(cxp + (rnd() * 2 - 1) * s),
        r6(cyp + (rnd() * 2 - 1) * s),
        r6(czp + (rnd() * 2 - 1) * s * 0.5),
      ]);
    }
    triangles.push({
      v,
      color: [r6(0.1 + 0.8 * rnd()), r6(0.1 + 0.8 * rnd()), r6(0.1 + 0.8 * rnd())],
      alpha: r6(0.15 + 0.6 * rnd()),
    });
  }
  return {
    width: 96,
    height: 96,
    camera: { halfW, halfH },
    background: [0.05, 0.06, 0.08],
    triangles,
    meta: { name: 'soup', seed, count, extent, spread },
  };
}

function layeredStack(seed, layers) {
  const rnd = mulberry32(seed);
  const triangles = [];
  for (let i = 0; i < layers; i++) {
    const z = -0.9 + (1.8 * i) / Math.max(1, layers - 1);
    const jx = (rnd() * 2 - 1) * 0.25;
    const jy = (rnd() * 2 - 1) * 0.25;
    const s = 0.9;
    // two triangles forming a big quad, fully covering the screen
    const q = [
      [-s + jx, -s + jy], [s + jx, -s + jy], [s + jx, s + jy], [-s + jx, s + jy],
    ];
    const triples = [[0, 1, 2], [0, 2, 3]];
    for (const t of triples) {
      triangles.push({
        v: t.map((k) => [r6(q[k][0]), r6(q[k][1]), r6(z)]),
        color: [r6(0.2 + 0.7 * rnd()), r6(0.2 + 0.7 * rnd()), r6(0.2 + 0.7 * rnd())],
        alpha: r6(0.2 + 0.5 * rnd()),
      });
    }
  }
  return {
    width: 96,
    height: 96,
    camera: { halfW: 1, halfH: 1 },
    background: [0.05, 0.06, 0.08],
    triangles,
    meta: { name: 'layered', seed, layers },
  };
}

mkdirSync(OUT, { recursive: true });
const soup = randomSoup(0x51f3a7, 700, 0.55, 0.34, 1.2, 1.2);
const layered = layeredStack(0x20ab77, 24);
writeFileSync(join(OUT, 'scene.json'), JSON.stringify(soup, null, 1) + '\n');
writeFileSync(join(OUT, 'scene-layered.json'), JSON.stringify(layered, null, 1) + '\n');
console.log(`wrote data/scene.json (${soup.triangles.length} triangles, ${soup.width}x${soup.height})`);
console.log(`wrote data/scene-layered.json (${layered.triangles.length} triangles)`);
