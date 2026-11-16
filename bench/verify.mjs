/**
 * bench/verify.mjs — behavioural assertions for the oitcert core.
 * Every assertion prints the measured value. exit 0 iff all pass.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../src/core.mjs';
import { renderOracle } from '../baseline/oracle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS ${name} :: ${detail}`); }
  else { fail++; console.log(`FAIL ${name} :: ${detail}`); }
}
const f6 = (x) => Number(x).toExponential(3);

// ---------- corpus ----------
const soup = load('data/scene.json');
const layered = load('data/scene-layered.json');
const W = soup.width, H = soup.height, bg = soup.background;

const rast = core.rasterize(soup);
const centroids = core.centroidDepths(soup);
const order = core.painterOrder(centroids);
const exact = core.compositeExact(rast, bg);
const painter = core.compositePainter(rast, order, bg);
const range = core.fragmentDepthRange(rast);
const wboit = core.compositeWBOIT(rast, bg, range.min, range.max);
const cP = core.compareImages(exact, painter, W, H);
const cW = core.compareImages(exact, wboit, W, H);
const viol = core.orderViolations(rast, order);

console.log(`# corpus: ${soup.triangles.length} tris, ${W}x${H}, fragments=${rast.fragmentCount}, degenerate=${rast.degenerate}`);

// A1 — independent ray-cast oracle must reproduce the rasterizer reference bit for bit
const orc = renderOracle(soup);
const cO = core.compareImages(exact, orc.image, W, H);
check('A1 oracle==exact', cO.maxDiff === 0 && orc.fragments === rast.fragmentCount,
  `maxDiff=${f6(cO.maxDiff)} rmse=${f6(cO.rmse)} oracleFragments=${orc.fragments} rasterFragments=${rast.fragmentCount}`);

// A2 — painter's algorithm is demonstrably wrong on interpenetrating soup
check('A2 painter visible error', cP.maxDiff > 0.2 && cP.visibleFraction > 0.01,
  `maxDiff=${cP.maxDiff.toFixed(6)} rmse=${f6(cP.rmse)} visible=${(100 * cP.visibleFraction).toFixed(2)}% worstPixel=(${cP.worstPixel.x},${cP.worstPixel.y})`);

// A3 — WBOIT (normalized) is also approximate, and worse in aggregate here
check('A3 wboit visible error', cW.maxDiff > 0.3,
  `maxDiff=${cW.maxDiff.toFixed(6)} rmse=${f6(cW.rmse)} visible=${(100 * cW.visibleFraction).toFixed(2)}%`);

// A4 — the global order genuinely disagrees with per-pixel order: witness pixel
check('A4 order violations', viol.pixels > 1000 && viol.witness !== null,
  `pixels=${viol.pixels} swappedPairs=${viol.pairs} witness=(${viol.witness.x},${viol.witness.y}) swapped=${viol.witness.swappedPairs}`);

// A5 — closed form: one triangle over the background
const one = { width: 8, height: 8, camera: { halfW: 1, halfH: 1 }, background: [0.05, 0.06, 0.08],
  triangles: [{ v: [[-2, -2, 0.4], [2, -2, 0.4], [0, 4, 0.4]], color: [0.9, 0.2, 0.1], alpha: 0.35 }] };
const r1 = core.rasterize(one);
const e1 = core.compositeExact(r1, one.background);
let closed1 = 0, worst1 = 0;
for (let i = 0; i < 64; i++) {
  const exp = [0.35 * 0.9 + 0.65 * 0.05, 0.35 * 0.2 + 0.65 * 0.06, 0.35 * 0.1 + 0.65 * 0.08];
  for (let c = 0; c < 3; c++) {
    const d = Math.abs(e1[3 * i + c] - exp[c]);
    if (d > worst1) worst1 = d;
  }
  closed1++;
}
check('A5 single-triangle closed form', worst1 < 1e-12, `pixels=${closed1} maxAbsDiff=${f6(worst1)}`);

// A6 — closed form: two screen-covering triangles, known depth order
const two = { width: 4, height: 4, camera: { halfW: 1, halfH: 1 }, background: [0.05, 0.06, 0.08],
  triangles: [
    { v: [[-2, -2, -0.5], [2, -2, -0.5], [0, 4, -0.5]], color: [1, 0, 0], alpha: 0.5 },
    { v: [[-2, -2, 0.5], [2, -2, 0.5], [0, 4, 0.5]], color: [0, 0, 1], alpha: 0.5 }] };
const r2 = core.rasterize(two);
const e2 = core.compositeExact(r2, two.background);
let worst2 = 0;
for (let i = 0; i < 16; i++) {
  const exp = [0.5 * 0 + 0.5 * 0.5 * 1 + 0.25 * 0.05, 0.25 * 0.06, 0.5 * 1 + 0.25 * 0.08];
  for (let c = 0; c < 3; c++) worst2 = Math.max(worst2, Math.abs(e2[3 * i + c] - exp[c]));
}
check('A6 two-triangle closed form', worst2 < 1e-12, `maxAbsDiff=${f6(worst2)}`);

// A7 — scale invariance across 12 orders of magnitude (geometry + camera scaled together)
const scales = [1e-6, 1e-3, 1, 1e3, 1e6];
const base = { pRmse: cP.rmse, pMax: cP.maxDiff, wRmse: cW.rmse, wMax: cW.maxDiff, hash: core.imageHash(exact) };
let worstScale = 0, sameHash = true;
const scaleRows = [];
for (const s of scales) {
  const sc = core.scaleScene(soup, s);
  const rr = core.rasterize(sc);
  const co = core.painterOrder(core.centroidDepths(sc));
  const ex = core.compositeExact(rr, bg);
  const pa = core.compositePainter(rr, co, bg);
  const rg = core.fragmentDepthRange(rr);
  const wb = core.compositeWBOIT(rr, bg, rg.min, rg.max);
  const p = core.compareImages(ex, pa, W, H);
  const w = core.compareImages(ex, wb, W, H);
  const rel = Math.max(
    Math.abs(p.rmse - base.pRmse) / Math.max(base.pRmse, 1e-30),
    Math.abs(w.rmse - base.wRmse) / Math.max(base.wRmse, 1e-30),
    Math.abs(p.maxDiff - base.pMax) / Math.max(base.pMax, 1e-30),
    Math.abs(w.maxDiff - base.wMax) / Math.max(base.wMax, 1e-30));
  if (rel > worstScale) worstScale = rel;
  if (core.imageHash(ex) !== base.hash) sameHash = false;
  scaleRows.push(`1e${Math.log10(s).toFixed(0)}:pRMSE=${f6(p.rmse)},wRMSE=${f6(w.rmse)}`);
}
check('A7 scale invariance 1e-6..1e6', worstScale < 1e-9 && sameHash,
  `maxRelDev=${f6(worstScale)} exactHashStable=${sameHash} [${scaleRows.join(' ')}]`);

// A8 — deterministic rasterization
const rast2 = core.rasterize(soup);
const e2b = core.compositeExact(rast2, bg);
check('A8 determinism', rast2.fragmentCount === rast.fragmentCount && core.imageHash(e2b) === core.imageHash(exact),
  `fragments=${rast2.fragmentCount}/${rast.fragmentCount} hash=${core.imageHash(e2b)}`);

// A9 — empty scene is exactly the background
const empty = { width: 8, height: 8, camera: { halfW: 1, halfH: 1 }, background: [0.05, 0.06, 0.08], triangles: [] };
const re = core.rasterize(empty);
const ee = core.compositeExact(re, empty.background);
let bgOk = true;
for (let i = 0; i < 64; i++) {
  if (ee[3 * i] !== 0.05 || ee[3 * i + 1] !== 0.06 || ee[3 * i + 2] !== 0.08) bgOk = false;
}
check('A9 empty scene == background', bgOk && re.fragmentCount === 0, `fragments=${re.fragmentCount} exactBackground=${bgOk}`);

// A10 — order independence: WBOIT and painter both ignore fragment arrival
// order (that is the point of "order independent"); painter does it by
// discarding the per-pixel order entirely, which is why its error vs exact is
// large. WBOIT's reversal difference is FP summation only.
const revPixels = rast.pixels.map((l) => (l === null ? null : l.slice().reverse()));
const revRast = { width: rast.width, height: rast.height, pixels: revPixels, fragmentCount: rast.fragmentCount, degenerate: rast.degenerate };
const wbRev = core.compositeWBOIT(revRast, bg, range.min, range.max);
const paRev = core.compositePainter(revRast, order, bg);
const cwRev = core.compareImages(wboit, wbRev, W, H);
const cpRev = core.compareImages(painter, paRev, W, H);
check('A10 order independence of approximation rules', cwRev.maxDiff < 1e-12 && cpRev.maxDiff === 0 && cP.maxDiff > 0.2,
  `wboitReversalDiff=${f6(cwRev.maxDiff)} painterReversalDiff=${f6(cpRev.maxDiff)} painterVsExactMax=${f6(cP.maxDiff)}`);

// A11 — the certificate separates regimes: parallel layers are exactly sortable
const rl = core.rasterize(layered);
const exL = core.compositeExact(rl, bg);
const paL = core.compositePainter(rl, core.painterOrder(core.centroidDepths(layered)), bg);
const rgL = core.fragmentDepthRange(rl);
const wbL = core.compositeWBOIT(rl, bg, rgL.min, rgL.max);
const pL = core.compareImages(exL, paL, W, H);
const wL = core.compareImages(exL, wbL, W, H);
const vl = core.orderViolations(rl, core.painterOrder(core.centroidDepths(layered)));
check('A11 layered: painter exact, wboit not', pL.maxDiff === 0 && vl.pixels === 0 && wL.maxDiff > 0.05,
  `layers=${layered.triangles.length} painterMax=${f6(pL.maxDiff)} wboitMax=${f6(wL.maxDiff)} orderViolations=${vl.pixels}`);

// A12 — every fragment lies inside the reported depth range
let inRange = true;
for (const list of rast.pixels) if (list) for (const f of list) if (f.z < range.min || f.z > range.max) inRange = false;
check('A12 fragments inside depth range', inRange && range.min < range.max,
  `zMin=${range.min.toFixed(6)} zMax=${range.max.toFixed(6)} inRange=${inRange}`);

console.log(`\nRESULT ${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
