/**
 * baseline/oracle.mjs — INDEPENDENT reference renderer for the oitcert scene.
 *
 * Deliberately shares no constants and no code with src/core.mjs:
 *   - it ray-casts each pixel centre in WORLD space (point-in-triangle via
 *     2D cross products on world XY) instead of walking screen-space bounding
 *     boxes with edge functions;
 *   - it recovers Z from the triangle's plane equation
 *     n = (v1-v0)x(v2-v0),  z = v0.z - (n.x*(x-v0.x) + n.y*(y-v0.y)) / n.z
 *     instead of barycentric interpolation of vertex Z;
 *   - it uses its own compositing loop and its own skip rule (projected 2D
 *     determinant exactly zero) rather than core's screen-space AREA_EPS.
 *
 * Pure ES module: no three / DOM / fs / net / env, no top-level side effects.
 */

export function renderOracle(scene) {
  const W = scene.width, H = scene.height;
  const halfW = scene.camera.halfW, halfH = scene.camera.halfH;
  const bg = scene.background;
  const tris = scene.triangles;
  const img = new Float64Array(W * H * 3);
  let fragments = 0;

  for (let py = 0; py < H; py++) {
    const y = (1 - (2 * py + 1) / H) * halfH;
    for (let px = 0; px < W; px++) {
      const x = ((2 * px + 1) / W - 1) * halfW;
      const hits = [];
      for (let ti = 0; ti < tris.length; ti++) {
        const v = tris[ti].v;
        const ax = v[0][0], ay = v[0][1];
        const bx = v[1][0], by = v[1][1];
        const cx = v[2][0], cy = v[2][1];
        const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (det === 0) continue;
        const d0 = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        const d1 = (cx - bx) * (y - by) - (cy - by) * (x - bx);
        const d2 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
        const inside = (d0 >= 0 && d1 >= 0 && d2 >= 0) || (d0 <= 0 && d1 <= 0 && d2 <= 0);
        if (!inside) continue;
        // plane equation in world space
        const ux = bx - ax, uy = by - ay, uz = v[1][2] - v[0][2];
        const wx = cx - ax, wy = cy - ay, wz = v[2][2] - v[0][2];
        const nx = uy * wz - uz * wy;
        const ny = uz * wx - ux * wz;
        const nz = ux * wy - uy * wx;
        if (nz === 0) continue;
        const z = v[0][2] - (nx * (x - ax) + ny * (y - ay)) / nz;
        hits.push({ z, a: tris[ti].alpha, r: tris[ti].color[0], g: tris[ti].color[1], b: tris[ti].color[2] });
        fragments++;
      }
      let R = bg[0], G = bg[1], B = bg[2];
      if (hits.length > 0) {
        hits.sort((p, q) => q.z - p.z);   // near (large z) first, front-to-back
        let T = 1, r = 0, g = 0, b = 0;
        for (let k = 0; k < hits.length; k++) {
          const f = hits[k];
          const w = T * f.a;
          r += w * f.r; g += w * f.g; b += w * f.b;
          T *= (1 - f.a);
        }
        R = r + T * bg[0]; G = g + T * bg[1]; B = b + T * bg[2];
      }
      const o = (py * W + px) * 3;
      img[o] = R; img[o + 1] = G; img[o + 2] = B;
    }
  }
  return { image: img, fragments };
}
