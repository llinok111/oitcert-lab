// main.js — rendering layer only. It does NOT recompute the certificate:
// every number shown is read verbatim from bench/result.json, which was
// produced by the same src/core.mjs under node.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 100);
camera.position.set(0, 0, 3.4);
const controls = new OrbitControls(camera, renderer.domElement);

const F = async (p) => (await fetch(p)).json();
const [soup, cert] = await Promise.all([F('./data/scene.json'), F('./bench/result.json')]);

const pos = [], col = [];
for (const t of soup.triangles) {
  for (const p of t.v) { pos.push(p[0], p[1], p[2]); col.push(t.color[0], t.color[1], t.color[2]); }
}
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45,
  side: THREE.DoubleSide, depthWrite: false, blending: THREE.NormalBlending });
scene.add(new THREE.Mesh(geo, mat));

const rows = [
  ['raster fragments', cert.corpus.primary.fragments],
  ['ray-cast oracle vs exact', `${cert.certificate.oracle_vs_exact.maxDiff} max channel diff`],
  ['painter vs exact', `${cert.certificate.painter_vs_exact.maxDiff.toFixed(6)} max, ${(100 * cert.certificate.painter_vs_exact.visibleFraction).toFixed(2)}% pixels >0.05`],
  ['wboit vs exact', `${cert.certificate.wboit_vs_exact.maxDiff.toFixed(6)} max, ${(100 * cert.certificate.wboit_vs_exact.visibleFraction).toFixed(2)}% pixels >0.05`],
  ['order-violating pixels', cert.certificate.order_violations.pixels],
  ['layered: painter / wboit max', `${cert.certificate.layered.painter_vs_exact_maxDiff} / ${cert.certificate.layered.wboit_vs_exact_maxDiff.toFixed(6)}`],
  ['exact sweep median', `${cert.timing_ms.full_sweep.median.toFixed(2)} ms`],
];
const tbl = document.getElementById('tbl');
for (const [k, v] of rows) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${k}</td><td class="${String(k).startsWith('painter') ? 'w' : 'v'}">${v}</td>`;
  tbl.appendChild(tr);
}

const op = document.getElementById('op');
op.addEventListener('input', () => { mat.opacity = op.value / 100; document.getElementById('opv').textContent = (op.value / 100).toFixed(2); });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
