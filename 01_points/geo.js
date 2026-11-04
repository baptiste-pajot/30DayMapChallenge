// Spherical geometry helpers: centroid, tied centres (Fréchet mean minimisers) and great-circle paths.
const DEG = Math.PI / 180;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp1 = x => Math.min(1, Math.max(-1, x));

function toVector({ lat, lng }) {
  const φ = lat * DEG, λ = lng * DEG;
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

const toLatLng = ([x, y, z]) => ({ lat: Math.asin(clamp1(z)) / DEG, lng: Math.atan2(y, x) / DEG });

// Spherical centroid: average the unit vectors, then normalise back onto the sphere.
// Returns null when the mean vector is ~0 (e.g. two antipodal points), where the centroid is undefined.
function sphericalCentroid(pts) {
  if (!pts.length) return null;
  const sum = pts.map(toVector).reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]);
  const norm = Math.hypot(...sum);
  if (norm / pts.length < 1e-6) return null;
  return { ...toLatLng(sum.map(c => c / norm)), strength: norm / pts.length };
}

// When the unit vectors cancel out, the mean direction says nothing (every point on the sphere ties).
// Fall back to the Fréchet mean, i.e. the points c minimising Σ d(c, pᵢ)² with d the great-circle distance,
// and return *all* of its minimisers: e.g. two antipodal points → the whole great circle halfway between them.
function frechet(c, vs) {
  let s = 0;
  for (const v of vs) { const θ = Math.acos(clamp1(dot(c, v))); s += θ * θ; }
  return s;
}

// Karcher-mean descent: move c along the mean of the log maps of the points.
function karcher(c, vs) {
  for (let iter = 0; iter < 200; iter++) {
    const m = [0, 0, 0];
    for (const v of vs) {
      const cosθ = clamp1(dot(c, v)), θ = Math.acos(cosθ), sinθ = Math.sin(θ);
      if (sinθ < 1e-12) continue;  // c on p or its antipode: no defined direction
      const k = θ / sinθ / vs.length;
      for (let j = 0; j < 3; j++) m[j] += k * (v[j] - cosθ * c[j]);
    }
    const L = Math.hypot(...m);
    if (L < 1e-10) break;
    c = c.map((cj, j) => Math.cos(L) * cj + Math.sin(L) * m[j] / L);
    const n = Math.hypot(...c);
    c = c.map(cj => cj / n);
  }
  return c;
}

function tiedCentres(pts) {
  const vs = pts.map(toVector);
  // 1. Coarse 1° grid search to seed the low regions.
  const cells = [];
  for (let lat = -89.5; lat < 90; lat++) {
    for (let lng = -179.5; lng < 180; lng++) {
      const c = toVector({ lat, lng });
      cells.push({ c, f: frechet(c, vs) });
    }
  }
  let fmin = Infinity, fmax = -Infinity;
  for (const { f } of cells) { fmin = Math.min(fmin, f); fmax = Math.max(fmax, f); }
  const seeds = cells.filter(({ f }) => f <= fmin + 0.005 * (fmax - fmin))
    .sort((a, b) => a.f - b.f).slice(0, 5000);

  // 2. Refine every seed to its local minimum, keep the global ones.
  const refined = seeds.map(({ c }) => { const r = karcher(c, vs); return { c: r, f: frechet(r, vs) }; });
  const best = Math.min(...refined.map(r => r.f));
  const tol = 1e-6 * Math.max(1, best);

  // 3. Deduplicate minimisers closer than 0.5°.
  const minCos = Math.cos(0.5 * DEG), kept = [];
  for (const { c, f } of refined) {
    if (f <= best + tol && !kept.some(k => dot(k, c) > minCos)) kept.push(c);
  }
  return kept.map(toLatLng);
}

// Great-circle path from a to b as [lng, lat] pairs (~1 segment per degree).
// Longitudes are unwrapped (may exceed ±180) so the line doesn't jump across the antimeridian.
function greatCircle(a, b) {
  const va = toVector(a), vb = toVector(b);
  const ω = Math.acos(clamp1(dot(va, vb)));
  const steps = Math.max(2, Math.ceil(ω / DEG));
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ka = ω < 1e-9 ? 1 - t : Math.sin((1 - t) * ω) / Math.sin(ω);
    const kb = ω < 1e-9 ? t : Math.sin(t * ω) / Math.sin(ω);
    let { lat, lng } = toLatLng([0, 1, 2].map(j => ka * va[j] + kb * vb[j]));
    if (coords.length) {
      const prev = coords[coords.length - 1][0];
      lng += 360 * Math.round((prev - lng) / 360);
    }
    coords.push([lng, lat]);
  }
  return coords;
}
