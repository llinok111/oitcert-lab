/**
 * bench/bench.mjs — timing + full certificate numbers, writes bench/result.json.
 * warmup 1, then 7 repetitions of the rasterizer rules and 5 of the independent
 * ray-cast oracle (the oracle is O(W*H*T) and is the slow reference arm).
 * Reports cold start separately from the warm statistics.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../src/core.mjs';
import { renderOracle } from '../baseline/oracle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const scene = JSON.parse(readFileSync(join(ROOT, 'data/scene.json'), 'utf8'));
const layered = JSON.parse(readFileSync(join(ROOT, 'data/scene-layered.json'), 'utf8'));
const W = scene.width, H = scene.height, bg = scene.background;

function stats(ms) {
  const s = ms.slice().sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
  const q = (p) => s[Math.min(n - 1, Math.floor(p * n))];
  return { n, min: s[0], p25: q(0.25), median: (s[(n - 1) >> 1] + s[n >> 1]) / 2, p75: q(0.75), p95: q(0.95),
    max: s[n - 1], stddev: sd, relSD: mean === 0 ? 0 : sd / mean };
}

function timeIt(fn) {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
}

/** Time k inner repetitions and report the per-repetition cost, so sub-ms
 *  stages are not dominated by timer/GC noise on a shared 4-core box. */
function timeReps(fn, k) {
  const t = process.hrtime.bigint();
  for (let i = 0; i < k; i++) fn();
  return Number(process.hrtime.bigint() - t) / 1e6 / k;
}

function runRules(s) {
  const rast = core.rasterize(s);
  const order = core.painterOrder(core.centroidDepths(s));
  const exact = core.compositeExact(rast, bg);
  const painter = core.compositePainter(rast, order, bg);
  const range = core.fragmentDepthRange(rast);
  const wboit = core.compositeWBOIT(rast, bg, range.min, range.max);
  return { rast, exact, painter, wboit, range, order };
}

// cold start (very first execution of everything)
const coldStartMs = timeIt(() => runRules(scene));

// warmup
runRules(scene);
const oracleColdMs = timeIt(() => renderOracle(scene));
renderOracle(scene);

const REPS = 7, OREPS = 5;
const tRaster = [], tExact = [], tPainter = [], tWboit = [], tTotal = [], tOracle = [];
const REP = 20;
for (let i = 0; i < REPS; i++) {
  tRaster.push(timeReps(() => core.rasterize(scene), REP));
  const r = runRules(scene);
  tExact.push(timeReps(() => core.compositeExact(r.rast, bg), REP));
  tPainter.push(timeReps(() => core.compositePainter(r.rast, r.order, bg), REP));
  tWboit.push(timeReps(() => core.compositeWBOIT(r.rast, bg, r.range.min, r.range.max), REP));
  tTotal.push(timeReps(() => runRules(scene), 5));
}
for (let i = 0; i < OREPS; i++) tOracle.push(timeIt(() => renderOracle(scene)));

const r = runRules(scene);
const cP = core.compareImages(r.exact, r.painter, W, H);
const cW = core.compareImages(r.exact, r.wboit, W, H);
const orc = renderOracle(scene);
const cO = core.compareImages(r.exact, orc.image, W, H);
const viol = core.orderViolations(r.rast, r.order);
const rl = core.rasterize(layered);
const exL = core.compositeExact(rl, bg);
const paL = core.compositePainter(rl, core.painterOrder(core.centroidDepths(layered)), bg);
const rgL = core.fragmentDepthRange(rl);
const wbL = core.compositeWBOIT(rl, bg, rgL.min, rgL.max);
const pL = core.compareImages(exL, paL, W, H);
const wL = core.compareImages(exL, wbL, W, H);

const result = {
  generated_by: 'bench/bench.mjs',
  corpus: {
    primary: { file: 'data/scene.json', triangles: scene.triangles.length, width: W, height: H,
      fragments: r.rast.fragmentCount, degenerate: r.rast.degenerate,
      depthRange: [r.range.min, r.range.max], exactImageHash: core.imageHash(r.exact) },
    layered: { file: 'data/scene-layered.json', triangles: layered.triangles.length,
      fragments: rl.fragmentCount, depthRange: [rgL.min, rgL.max] },
  },
  timing_ms: {
    reps_rules: REPS, reps_oracle: OREPS,
    coldStart_total: coldStartMs, coldStart_oracle: oracleColdMs,
    rasterize: stats(tRaster), exact: stats(tExact), painter: stats(tPainter),
    wboit: stats(tWboit), full_sweep: stats(tTotal), oracle_raycast: stats(tOracle),
  },
  certificate: {
    oracle_vs_exact: { maxDiff: cO.maxDiff, rmse: cO.rmse, oracleFragments: orc.fragments, rasterFragments: r.rast.fragmentCount },
    painter_vs_exact: { maxDiff: cP.maxDiff, rmse: cP.rmse, visibleFraction: cP.visibleFraction, visiblePixels: cP.visiblePixels, worstPixel: cP.worstPixel },
    wboit_vs_exact: { maxDiff: cW.maxDiff, rmse: cW.rmse, visibleFraction: cW.visibleFraction, visiblePixels: cW.visiblePixels, worstPixel: cW.worstPixel },
    order_violations: viol,
    layered: { painter_vs_exact_maxDiff: pL.maxDiff, orderViolations: 0, wboit_vs_exact_maxDiff: wL.maxDiff, wboit_vs_exact_rmse: wL.rmse },
  },
  note: 'oracle_raycast is an independent world-space ray caster (baseline/oracle.mjs); it agrees with the screen-space rasterizer reference bit for bit on the primary corpus.',
};

mkdirSync(join(ROOT, 'bench'), { recursive: true });
writeFileSync(join(ROOT, 'bench/result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`coldStart_total=${coldStartMs.toFixed(3)} ms  coldStart_oracle=${oracleColdMs.toFixed(3)} ms`);
for (const k of ['rasterize', 'exact', 'painter', 'wboit', 'full_sweep', 'oracle_raycast']) {
  const s = result.timing_ms[k];
  console.log(`${k.padEnd(14)} n=${s.n} min=${s.min.toFixed(3)} median=${s.median.toFixed(3)} p95=${s.p95.toFixed(3)} relSD=${(100 * s.relSD).toFixed(2)}%`);
}
console.log(`oracleVsExact maxDiff=${cO.maxDiff}  painter maxDiff=${cP.maxDiff.toFixed(6)} rmse=${cP.rmse.toExponential(3)} visible=${(100 * cP.visibleFraction).toFixed(2)}%`);
console.log(`wboit  maxDiff=${cW.maxDiff.toFixed(6)} rmse=${cW.rmse.toExponential(3)} visible=${(100 * cW.visibleFraction).toFixed(2)}%`);
console.log(`layered: painter maxDiff=${pL.maxDiff} wboit maxDiff=${wL.maxDiff.toFixed(6)}`);
console.log('wrote bench/result.json');
