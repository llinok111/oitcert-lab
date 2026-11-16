# oitcert-lab — order-independent transparency error certificate

Every transparency blend rule gets a **per-pixel max-error certificate with a witness pixel**.
On the 700-triangle in-repo corpus the classic **global-sort painter baseline** is off by
**0.249195** max channel (rmse 1.240e-2, **2.22 % of pixels** visibly wrong, **1074 pixels with a
provably wrong per-pixel depth order**), while the exact reference is verified **bit-identical
(maxDiff = 0)** by an independently written ray caster. The same certificate proves the opposite
regime: on a parallel-layer corpus the painter sort is **exactly correct (maxDiff = 0)**, while the
weighted-blended OIT approximation is not.

Upstream: none

This is an original tool. The blend rules themselves are prior art and are **not** the claim:
WBOIT is McGuire & Bavoil 2013 (JCGT), painter's algorithm is textbook. What is new here is the
per-pixel certificate (witness pixel + swapped-pair count) and the fact that a screen-space
rasterizer and a world-space ray caster, written independently, are shown to agree bit for bit.

## How to run

```bash
node --version                       # Node >= 20 (developed on v24.19.0)
node tools/gen-sample.mjs            # writes data/scene.json, data/scene-layered.json (deterministic)
node bench/verify.mjs                # 12 assertions, prints every measured value, exit 0 on pass
node bench/bench.mjs                 # 7 reps + cold start, writes bench/result.json
python3 -m http.server 4173          # then open http://localhost:4173  (three@0.169.0 via importmap)
```

One command for the whole certificate: `node tools/gen-sample.mjs && node bench/verify.mjs && node bench/bench.mjs`.

## Evidence (`bench/result.json`)

Corpus: `data/scene.json`, 700 interpenetrating triangles, 96×96, 21129 fragments, exact-image hash
`c7ea87fb` (bit-reproducible).

| rule | what it is | max channel diff | rmse | pixels > 0.05 |
| --- | --- | --- | --- | --- |
| exact (reference) | per-pixel nearest-first over-compositing | — | — | — |
| **oracle** (`baseline/oracle.mjs`) | world-space ray cast, plane-equation Z | **0** | **0** | 0 / 9216 |
| **painter** (baseline) | one global centroid sort | **0.249195** | 1.240e-2 | 2.22 % (204) |
| **wboit** | weighted-blended OIT, depth normalized | **0.397833** | 4.229e-2 | 19.03 % (1754) |

Witnesses and structural numbers:

- worst painter pixel **(38, 40)**; worst WBOIT pixel is also named in `bench/result.json`;
- **1074 pixels** where the global sort disagrees with the true per-pixel order
  (**1788 swapped fragment pairs**), first witness **(43, 23)**;
- layered corpus (48 triangles, 170525 fragments): painter **maxDiff = 0**, order violations **0**,
  WBOIT **maxDiff = 0.181582** — the certificate separates the two regimes;
- scale invariance: geometry + camera scaled 1e-6 / 1e-3 / 1 / 1e3 / 1e6 give the **same exact-image
  hash** and max relative deviation **1.64e-16** in every error metric.

Timing (ms; warmup 1, 7 reps, cold start reported separately):

| stage | min | median | p95 | relSD |
| --- | --- | --- | --- | --- |
| rasterize | 1.065 | 1.180 | 2.070 | 25.27 % |
| exact compositing | 1.671 | 1.887 | 2.364 | 11.34 % |
| painter compositing | 1.499 | 1.641 | 2.018 | 9.58 % |
| wboit compositing | 0.260 | 0.288 | 0.654 | 38.74 % |
| full sweep | 5.077 | 5.872 | 7.590 | 16.16 % |
| oracle ray cast | 97.813 | 99.255 | 106.324 | 3.10 % |

Cold start: full sweep 31.45 ms, oracle 130.70 ms. The deterministic outputs are bit-reproducible;
the wall clock of the sub-2 ms stages is **not** — on a shared 4-core host those stages carry
relSD 10–39 %, so read them as order-of-magnitude only. The 99 ms ray caster (relSD 3.10 %) is the
stable timing anchor. This is why the certificate's maxima and counts, not its microseconds, are
the deliverable.

## 本轮创新

**B 档.** New here: (1) a per-pixel OIT error certificate that reports, for any order-independent
rule, the max channel error, the visible-pixel fraction, the **witness pixel**, and how many pixels
have a **provably wrong per-pixel depth order** (with the swapped-pair count); (2) **two
independent implementations** that must agree bit for bit — a screen-space rasterizer using
barycentric Z vs a world-space ray caster using the plane equation — plus closed-form single- and
two-triangle oracles; (3) the measured regime split: a global painter sort is *exactly* correct on
parallel layers (0 error, 0 order violations) and *visibly* wrong on interpenetrating soup.
Every number above is produced by the same `src/core.mjs` that the browser page reads.
The closed-form oracle earned its keep: it caught a real bug where **both** the rasterizer and the
"independent" ray caster used the same back-to-front accumulation convention and were wrong
together (maxDiff 2.5e-1 against the closed form) — see `## Independent verification`.

## Layout

```
index.html          single entry, importmap pins three@0.169.0
main.js             rendering + orbit only; reads bench/result.json, recomputes nothing
src/core.mjs        rasterizer, three blend rules, metrics, witness, scale helper (pure ESM)
baseline/oracle.mjs independent world-space ray caster (shares no constant with src/core.mjs)
tools/gen-sample.mjs deterministic corpus generator
bench/verify.mjs    12 assertions
bench/bench.mjs     timing + certificate, writes bench/result.json
```

## Known limitations

- **Absolute thresholds, disclosed**: `AREA_EPS = 1e-14` (triangle area in normalized screen units,
  screen ∈ [-1,1]²) and `OVER_THRESHOLD = 0.05` (per-channel RGB). Because both live in normalized
  screen space, they are invariant under any world/camera rescale — verified at 1e-6…1e6.
  Triangles whose projected area is below `AREA_EPS` are skipped by both the rasterizer and the oracle.
- **Orthographic camera only.** Linear screen-space Z is exact under orthographic projection;
  perspective-correct interpolation is not implemented.
- **Center sampling only.** A pixel counts as covered iff its centre is inside the triangle; no
  conservative coverage, so sub-pixel slivers can be missed by both implementations equally.
- **WBOIT constants are not the paper's.** The paper weights by absolute eye-space depth / 200; here
  depth is normalized to the scene span so the rule is scale invariant. That normalization changes
  the weight balance and is part of why our measured WBOIT error is larger than the paper's typical
  reported quality. The corpus alpha range (0.15–0.75) is also fairly opaque. All numbers are
  corpus-specific; the certificate is a measurement, not a verdict on the algorithm.
- **Order independence is mathematical, not bitwise**: reversing every fragment list changes the
  WBOIT image by 6.66e-16 (floating-point summation order).
- `painter` and `wboit` are the two approximation arms; depth peeling and per-pixel exact sorting
  under a fragment budget are not implemented.

## Independent verification

The closed-form two-triangle assertion (`A6` in `bench/verify.mjs`) caught a real defect during
development: the exact compositor and `baseline/oracle.mjs` both accumulated
`C += T·a·c; T *= (1−a)` while walking **far-to-near**, which applies the layers in the wrong order.
Both implementations agreed with each other and were both wrong (0.25 max channel error against the
closed form) — a textbook case of an oracle that is immune to the very dimension it claims to check.
Sorting near-to-far fixed both; after the fix the closed form, the rasterizer and the ray caster all
agree to 0.0, and the oracle/rasterizer identity is `maxDiff = 0` over all 21129 fragments.
