// Spherical geometry helpers: great-circle distance and path.
const DEG = Math.PI / 180;
const EARTH_RADIUS_KM = 6371;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp1 = x => Math.min(1, Math.max(-1, x));

function toVector({ lat, lng }) {
  const φ = lat * DEG, λ = lng * DEG;
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

const toLatLng = ([x, y, z]) => ({ lat: Math.asin(clamp1(z)) / DEG, lng: Math.atan2(y, x) / DEG });

// Central angle between two points, in radians (multiply by EARTH_RADIUS_KM for km).
const angle = (a, b) => Math.acos(clamp1(dot(toVector(a), toVector(b))));

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
    if (coords.length) lng += 360 * Math.round((coords[coords.length - 1][0] - lng) / 360);
    coords.push([lng, lat]);
  }
  return coords;
}
