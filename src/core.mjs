/**
 * oitcert-core — order-independent transparency (OIT) error certificate.
 *
 * Pure ES module. Does NOT import three / three-anything, does NOT touch
 * window, document, navigator, requestAnimationFrame, fs, net or env.
 * Everything here is a pure function of the scene object passed in.
 *
 * The module contains, in one file:
 *   - a screen-space software rasterizer (center-sampled, orthographic) that
 *     turns a triangle soup into per-pixel fragment lists;
 *   - three compositing rules over the SAME fragment lists:
 *       exact    : per-pixel near-to-far "over" (the reference, order exact)
 *       painter  : one global far-to-near triangle sort (classic wrong answer)
 *       wboit    : weighted-blended OIT (McGuire & Bavoil 2013), depth
 *                  normalized to the scene span so it is scale invariant;
 *   - metrics + a per-pixel witness for the largest error;
 *   - an order-violation counter that names the exact pixel where the global
 *     sort disagrees with the true per-pixel depth order.
 *
 * Camera model: orthographic, looking down -Z. Screen coordinate of a world
 * point is (x / camera.halfW, y / camera.halfH) in [-1, 1]^2. Pixel centres are
 * sx = (2*px + 1)/W - 1 and sy = 1 - (2*py + 1)/H. Under an orthographic
 * camera the Z of a fragment is linear in screen space, so barycentric Z
 * interpolation on the projected triangle is exact.
 */

/** Screen-space triangle area threshold, in screen units^2 (screen is [-1,1]^2,
 *  i.e. resolution independent). Absolute value, but because it lives in
 *  normalized screen space it is invariant under any world/camera rescale. */
export const AREA_EPS = 1e-14;

/** A per-pixel max-channel RGB difference at or above this is called "visible". */
export const OVER_THRESHOLD = 0.05;

/** Weighted-blended OIT constants (McGuire & Bavoil 2013, "Weighted Blended
 *  Order-Independent Transparency", JCGT). Depth is normalized to [0,1] here
 *  instead of the paper's eye-space depth/200, to remove world-scale dependence. */
export const WBOIT_K = 0.03;
export const WBOIT_EPS = 1e-5;
export const WBOIT_MIN_W = 1e-2;
export const WBOIT_MAX_W = 3e3;
export const WBOIT_ALPHA_FLOOR = 1e-5;

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Pixel centre (sx, sy) in [-1,1]^2 for pixel (px, py). */
export function pixelCenter(px, py, W, H) {
  return [(2 * px + 1) / W - 1, 1 - (2 * py + 1) / H];
}

/**
 * Rasterize the scene into per-pixel fragment lists.
 * Returns { width, height, pixels: Array(W*H) of null | Fragment[] }.
 * Fragment = { z, a, r, g, b, tri }.
 */
export function rasterize(scene) {
  const W = scene.width;
  const H = scene.height;
  const halfW = scene.camera.halfW;
  const halfH = scene.camera.halfH;
  const tris = scene.triangles;
  const pixels = new Array(W * H);
  for (let i = 0; i < pixels.length; i++) pixels[i] = null;
  let fragmentCount = 0;
  let degenerate = 0;

  for (let ti = 0; ti < tris.length; ti++) {
    const t = tris[ti];
    const v = t.v;
    const sx0 = v[0][0] / halfW, sy0 = v[0][1] / halfH;
    const sx1 = v[1][0] / halfW, sy1 = v[1][1] / halfH;
    const sx2 = v[2][0] / halfW, sy2 = v[2][1] / halfH;
    const area = (sx1 - sx0) * (sy2 - sy0) - (sy1 - sy0) * (sx2 - sx0);
    if (!(Math.abs(area) >= AREA_EPS)) { degenerate++; continue; }
    const invArea = 1 / area;

    const minSx = Math.min(sx0, sx1, sx2), maxSx = Math.max(sx0, sx1, sx2);
    const minSy = Math.min(sy0, sy1, sy2), maxSy = Math.max(sy0, sy1, sy2);
    const px0 = Math.max(0, Math.ceil(((minSx + 1) * W - 1) / 2));
    const px1 = Math.min(W - 1, Math.floor(((maxSx + 1) * W - 1) / 2));
    const py0 = Math.max(0, Math.ceil(((1 - maxSy) * H - 1) / 2));
    const py1 = Math.min(H - 1, Math.floor(((1 - minSy) * H - 1) / 2));
    if (px0 > px1 || py0 > py1) continue;

    const z0 = v[0][2], z1 = v[1][2], z2 = v[2][2];
    const a = t.alpha, r = t.color[0], g = t.color[1], b = t.color[2];

    for (let py = py0; py <= py1; py++) {
      const sy = 1 - (2 * py + 1) / H;
      const rowBase = py * W;
      for (let px = px0; px <= px1; px++) {
        const sx = (2 * px + 1) / W - 1;
        const w0 = ((sx1 - sx) * (sy2 - sy) - (sy1 - sy) * (sx2 - sx)) * invArea;
        if (w0 < 0) continue;
        const w1 = ((sx2 - sx) * (sy0 - sy) - (sy2 - sy) * (sx0 - sx)) * invArea;
        if (w1 < 0) continue;
        const w2 = 1 - w0 - w1;
        if (w2 < 0) continue;
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        const idx = rowBase + px;
        let list = pixels[idx];
        if (list === null) { list = []; pixels[idx] = list; }
        list.push({ z, a, r, g, b, tri: ti });
        fragmentCount++;
      }
    }
  }
  return { width: W, height: H, pixels, fragmentCount, degenerate };
}

/** Centroid Z per triangle, in scene order. */
export function centroidDepths(scene) {
  const out = new Float64Array(scene.triangles.length);
  for (let i = 0; i < scene.triangles.length; i++) {
    const v = scene.triangles[i].v;
    out[i] = (v[0][2] + v[1][2] + v[2][2]) / 3;
  }
  return out;
}

/** Triangle indices sorted near (large z) to far (small z).
 *  The compositors walk front-to-back: C += T*a*c; T *= (1-a). */
export function painterOrder(centroids) {
  const order = new Int32Array(centroids.length);
  for (let i = 0; i < order.length; i++) order[i] = i;
  const arr = Array.from(order);
  arr.sort((p, q) => (centroids[q] - centroids[p]) || (p - q));
  return Int32Array.from(arr);
}

function newImage(nPixels, bg) {
  const img = new Float64Array(nPixels * 3);
  for (let i = 0; i < nPixels; i++) {
    img[3 * i] = bg[0]; img[3 * i + 1] = bg[1]; img[3 * i + 2] = bg[2];
  }
  return img;
}

/** Exact per-pixel front-to-back over-compositing (the reference rule).
 *  C += T*a*c ; T *= (1-a), walking nearest (large z) first. */
export function compositeExact(rast, bg) {
  const img = newImage(rast.pixels.length, bg);
  for (let i = 0; i < rast.pixels.length; i++) {
    const list = rast.pixels[i];
    if (list === null) continue;
    const s = list.slice().sort((p, q) => q.z - p.z);
    let T = 1, R = 0, G = 0, B = 0;
    for (let k = 0; k < s.length; k++) {
      const f = s[k];
      const w = T * f.a;
      R += w * f.r; G += w * f.g; B += w * f.b;
      T *= (1 - f.a);
    }
    img[3 * i] = R + T * bg[0];
    img[3 * i + 1] = G + T * bg[1];
    img[3 * i + 2] = B + T * bg[2];
  }
  return img;
}

/** Classic painter's algorithm: one global far-to-near triangle sort. */
export function compositePainter(rast, order, bg) {
  const nTri = order.length;
  const rank = new Int32Array(nTri);
  for (let k = 0; k < nTri; k++) rank[order[k]] = k;
  const img = newImage(rast.pixels.length, bg);
  for (let i = 0; i < rast.pixels.length; i++) {
    const list = rast.pixels[i];
    if (list === null) continue;
    const s = list.slice().sort((p, q) => (rank[p.tri] - rank[q.tri]) || (p.z - q.z));
    let T = 1, R = 0, G = 0, B = 0;
    for (let k = 0; k < s.length; k++) {
      const f = s[k];
      const w = T * f.a;
      R += w * f.r; G += w * f.g; B += w * f.b;
      T *= (1 - f.a);
    }
    img[3 * i] = R + T * bg[0];
    img[3 * i + 1] = G + T * bg[1];
    img[3 * i + 2] = B + T * bg[2];
  }
  return img;
}

/** Weighted-blended OIT (approximate), depth normalized to the scene span. */
export function compositeWBOIT(rast, bg, zMin, zMax) {
  const span = Math.max(zMax - zMin, 1e-12);
  const img = newImage(rast.pixels.length, bg);
  for (let i = 0; i < rast.pixels.length; i++) {
    const list = rast.pixels[i];
    if (list === null) continue;
    let ar = 0, ag = 0, ab = 0, aa = 0, reveal = 1;
    for (let k = 0; k < list.length; k++) {
      const f = list[k];
      // distance from the camera (camera looks down -Z from +Z), normalized:
      // d = 0 at the nearest fragment, 1 at the farthest, matching the paper's
      // intent that near fragments dominate the weight.
      const d = (zMax - f.z) / span;
      const d2 = d * d;
      const w = f.a * clamp(WBOIT_K / (WBOIT_EPS + d2 * d2), WBOIT_MIN_W, WBOIT_MAX_W);
      const aw = f.a * w;
      ar += f.r * aw; ag += f.g * aw; ab += f.b * aw; aa += aw;
      reveal *= (1 - f.a);
    }
    const inv = 1 / Math.max(aa, WBOIT_ALPHA_FLOOR);
    const vis = 1 - reveal;
    img[3 * i] = (ar * inv) * vis + bg[0] * reveal;
    img[3 * i + 1] = (ag * inv) * vis + bg[1] * reveal;
    img[3 * i + 2] = (ab * inv) * vis + bg[2] * reveal;
  }
  return img;
}

/** Depth range over all fragments actually produced (not over the raw AABB). */
export function fragmentDepthRange(rast) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < rast.pixels.length; i++) {
    const list = rast.pixels[i];
    if (list === null) continue;
    for (let k = 0; k < list.length; k++) {
      if (list[k].z < lo) lo = list[k].z;
      if (list[k].z > hi) hi = list[k].z;
    }
  }
  return { min: lo, max: hi };
}

function pixelDiff(ra, ga, ba, rb, gb, bb) {
  const d0 = Math.abs(ra - rb), d1 = Math.abs(ga - gb), d2 = Math.abs(ba - bb);
  return d0 > d1 ? (d0 > d2 ? d0 : d2) : (d1 > d2 ? d1 : d2);
}

/** Compare two images: max/mean error, RMSE, visible-pixel fraction, top witnesses. */
export function compareImages(a, b, W, H, threshold = OVER_THRESHOLD) {
  const n = W * H;
  let maxDiff = 0, sumSq = 0, overCount = 0, worstIdx = -1;
  const worst = [];
  for (let i = 0; i < n; i++) {
    const d = pixelDiff(a[3 * i], a[3 * i + 1], a[3 * i + 2], b[3 * i], b[3 * i + 1], b[3 * i + 2]);
    const d0 = a[3 * i] - b[3 * i], d1 = a[3 * i + 1] - b[3 * i + 1], d2 = a[3 * i + 2] - b[3 * i + 2];
    sumSq += d0 * d0 + d1 * d1 + d2 * d2;
    if (d > maxDiff) { maxDiff = d; worstIdx = i; }
    if (d >= threshold) overCount++;
    if (worst.length < 5 || d > worst[worst.length - 1].d) {
      worst.push({ i, d });
      worst.sort((p, q) => q.d - p.d);
      if (worst.length > 5) worst.pop();
    }
  }
  return {
    maxDiff,
    rmse: Math.sqrt(sumSq / (n * 3)),
    visiblePixels: overCount,
    visibleFraction: overCount / n,
    worstPixel: worstIdx < 0 ? null : { x: worstIdx % W, y: Math.floor(worstIdx / W), diff: maxDiff },
    top5: worst.map((w) => ({ x: w.i % W, y: Math.floor(w.i / W), diff: w.d })),
  };
}

/**
 * Count pixels where the global painter order disagrees with the true per-pixel
 * depth order, and return the first such pixel as a witness.
 * painterOrder walks near (large z) to far; a violation is an adjacent pair
 * (in that order) whose Z increases, i.e. a farther fragment drawn first.
 */
export function orderViolations(rast, order) {
  const rank = new Int32Array(order.length);
  for (let k = 0; k < order.length; k++) rank[order[k]] = k;
  let pixels = 0, pairs = 0;
  let witness = null;
  for (let i = 0; i < rast.pixels.length; i++) {
    const list = rast.pixels[i];
    if (list === null || list.length < 2) continue;
    let hit = 0;
    for (let k = 0; k + 1 < list.length; k++) {
      for (let m = k + 1; m < list.length; m++) {
        const rk = rank[list[k].tri], rm = rank[list[m].tri];
        if (rk < rm && list[k].z < list[m].z) hit++;       // k drawn first but is farther
        else if (rk > rm && list[k].z > list[m].z) hit++;  // m drawn first but is farther
      }
    }
    if (hit > 0) {
      pixels++;
      pairs += hit;
      if (witness === null) witness = { x: i % rast.width, y: Math.floor(i / rast.width), swappedPairs: hit, fragments: list.length };
    }
  }
  return { pixels, pairs, witness };
}

/** Deterministic FNV-1a hash of an image's exact double bytes. */
export function imageHash(img) {
  const bytes = new Uint8Array(img.buffer, img.byteOffset, img.byteLength);
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Scale a scene (geometry + orthographic half-extents + depth) by s. */
export function scaleScene(scene, s) {
  return {
    width: scene.width,
    height: scene.height,
    background: scene.background.slice(),
    camera: { halfW: scene.camera.halfW * s, halfH: scene.camera.halfH * s },
    triangles: scene.triangles.map((t) => ({
      v: t.v.map((p) => [p[0] * s, p[1] * s, p[2] * s]),
      color: t.color.slice(),
      alpha: t.alpha,
    })),
  };
}

/** Full rule sweep over one scene. Returns every number the certificate uses. */
export function evaluateScene(scene) {
  const rast = rasterize(scene);
  const centroids = centroidDepths(scene);
  const order = painterOrder(centroids);
  const bg = scene.background;
  const exact = compositeExact(rast, bg);
  const painter = compositePainter(rast, order, bg);
  const range = fragmentDepthRange(rast);
  const wboit = compositeWBOIT(rast, bg, range.min, range.max);
  const viol = orderViolations(rast, order);
  const W = scene.width, H = scene.height;
  return {
    raster: { fragments: rast.fragmentCount, degenerate: rast.degenerate,
      emptyPixels: rast.pixels.reduce((n, p) => n + (p === null ? 1 : 0), 0) },
    depthRange: range,
    exactHash: imageHash(exact),
    painter: compareImages(exact, painter, W, H),
    wboit: compareImages(exact, wboit, W, H),
    violations: viol,
    _images: { exact, painter, wboit },
  };
}
