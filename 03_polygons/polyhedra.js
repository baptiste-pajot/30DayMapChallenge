// Day 3 maths: polyhedra inscribed in the unit sphere, ordered by face count. Depends on utils/geo.js (dot, DEG).
// Each face is a flat polygon {n, verts} (outward unit normal, vertices on the unit sphere in CCW order seen from
// outside). The Earth is mapped onto a face by central (gnomonic) projection: a face point x shows the place in
// direction x/|x| from the Earth's centre, so great circles stay straight on every face.

const PHI = (1 + Math.sqrt(5)) / 2;

const v3add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const v3cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const v3unit = a => v3scale(a, 1 / Math.hypot(...a));

const cyclic = ([x, y, z]) => [[x, y, z], [y, z, x], [z, x, y]];
// Every sign combination of the non-zero coordinates: signs([1, 0, 2]) → [1,0,2], [1,0,-2], [-1,0,2], [-1,0,-2].
const signs = v => v.reduce((out, c) => out.flatMap(o => c ? [[...o, c], [...o, -c]] : [[...o, 0]]), [[]]);

// Rotation taking unit vector a onto unit vector b (Rodrigues), applied to a list of points.
function alignTo(points, a, b) {
  const k = v3cross(a, b), s = Math.hypot(...k), c = dot(a, b);
  if (s < 1e-12) return points;
  const u = v3scale(k, 1 / s);
  return points.map(p => v3add(v3add(v3scale(p, c), v3scale(v3cross(u, p), s)), v3scale(u, dot(u, p) * (1 - c))));
}

// Polygon face from its (unordered) vertices and outward normal: vertices sorted CCW around the normal.
function makeFace(verts, n) {
  const centre = v3scale(verts.reduce(v3add), 1 / verts.length);
  const e1 = v3unit(v3sub(verts[0], centre)), e2 = v3cross(n, e1);
  const at = v => { const d = v3sub(v, centre); return Math.atan2(dot(d, e2), dot(d, e1)); };
  return { n, verts: [...verts].sort((a, b) => at(a) - at(b)) };
}

// Faces of the convex hull of points on the unit sphere: every plane through 3 of them with no point beyond it.
// Brute force (O(n³), early exit), fine for the ≤ 60 vertices of the Platonic/Archimedean solids.
function hullFaces(points) {
  const faces = [], seen = new Set(), eps = 1e-7;
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) for (let k = j + 1; k < points.length; k++) {
    let n = v3cross(v3sub(points[j], points[i]), v3sub(points[k], points[i]));
    const len = Math.hypot(...n);
    if (len < eps) continue;
    n = v3scale(n, 1 / len);
    let d = dot(n, points[i]);
    if (d < 0) { n = v3scale(n, -1); d = -d; }  // the centre is inside, so the outward normal points away from it
    if (points.some(p => dot(n, p) > d + eps)) continue;
    const key = n.map(c => Math.round(c * 1e5) || 0).join();  // `|| 0` folds -0 into 0
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push(makeFace(points.filter(p => Math.abs(dot(n, p) - d) < eps), n));
  }
  return faces;
}

// Geodesic polyhedron: each icosahedron triangle split into freq² triangles, vertices pushed out onto the sphere.
function geodesic(icosaFaces, freq) {
  const faces = [];
  for (const { verts: [A, B, C] } of icosaFaces) {
    const P = (i, j) => v3unit(v3add(A, v3add(v3scale(v3sub(B, A), i / freq), v3scale(v3sub(C, A), j / freq))));
    const tri = (a, b, c) => faces.push(makeFace([a, b, c], v3unit(v3cross(v3sub(b, a), v3sub(c, a)))));
    for (let i = 0; i < freq; i++) for (let j = 0; i + j < freq; j++) {
      tri(P(i, j), P(i + 1, j), P(i, j + 1));
      if (i + j < freq - 1) tri(P(i + 1, j), P(i + 1, j + 1), P(i, j + 1));
    }
  }
  return faces;
}

// Area of a planar polygon face (fan of triangles from its first vertex).
function faceArea({ verts }) {
  let s = 0;
  for (let i = 1; i < verts.length - 1; i++) s += Math.hypot(...v3cross(v3sub(verts[i], verts[0]), v3sub(verts[i + 1], verts[0])));
  return s / 2;
}

// Summary numbers shown under each solid:
// - coverage: polyhedron surface / sphere surface (→ 1 as faces multiply);
// - stretch: worst gnomonic area exaggeration, at a face corner vs its centre: 1 / cos³θ, θ = centre-to-corner angle.
function solid(name, faces) {
  const area = faces.reduce((s, f) => s + faceArea(f), 0);
  const cosMin = Math.min(...faces.flatMap(f => f.verts.map(v => dot(f.n, v))));
  return { name, faces, coverage: area / (4 * Math.PI), stretch: 1 / cosMin ** 3 };
}

const NORTH = [0, 0, 1];
// Icosahedron family (icosa, truncated icosa, geodesics; the dodecahedron is built as its dual) turned so an
// icosahedron vertex sits on the North Pole.
const icosaFamily = pts => alignTo(pts.map(v3unit), v3unit([0, 1, PHI]), NORTH);
const ICOSA_FACES = hullFaces(icosaFamily(cyclic([0, 1, PHI]).flatMap(signs)));

const SOLIDS = [
  solid('Tetrahedron', hullFaces(alignTo([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(v3unit), v3unit([1, 1, 1]), NORTH))),
  solid('Cube', hullFaces(signs([1, 1, 1]).map(v3unit))),
  solid('Octahedron', hullFaces(cyclic([1, 0, 0]).flatMap(signs))),
  solid('Dodecahedron', hullFaces(ICOSA_FACES.map(f => f.n))),  // dual: icosahedron face centres → face on the pole
  solid('Icosahedron', ICOSA_FACES),
  solid('Truncated icosahedron', hullFaces(icosaFamily([[0, 1, 3 * PHI], [1, 2 + PHI, 2 * PHI], [PHI, 2, PHI ** 3]].flatMap(cyclic).flatMap(signs)))),
  solid('Geodesic sphere, frequency 2', geodesic(ICOSA_FACES, 2)),
  solid('Geodesic sphere, frequency 4', geodesic(ICOSA_FACES, 4)),
  solid('Geodesic sphere, frequency 16', geodesic(ICOSA_FACES, 16)),
];
