// Day 3 · Polygons: the Earth cut into polyhedra faces. Depends on utils/config.js, utils/geo.js and polyhedra.js.
// WebGL2, no Mapbox GL: the Earth is a Web Mercator texture stitched from Mapbox static tiles, and the fragment
// shader maps every face pixel to the place behind it (direction from the centre → lat/lng → Mercator → texel).

const TILE_ZOOM = 2, TILE_SIZE = 512;  // 4 × 4 tiles → 2048 px square texture
const STYLE = 'mapbox/streets-v12';  // same style as the other days
const PANEL_WIDTH = 330;               // #panel (16 + 280 + padding) covers the left of the canvas

const statusBox = document.getElementById('status');

if (!window.MAPBOX_TOKEN) {
  const warning = document.createElement('div');
  warning.id = 'token-warning';
  warning.innerHTML = `<b>Mapbox token missing.</b> Copy <code>utils/config.example.js</code> to
    <code>utils/config.js</code> and set <code>MAPBOX_TOKEN</code> to your public token (<code>pk.…</code>).`;
  document.body.appendChild(warning);
  throw new Error('Missing MAPBOX_TOKEN in utils/config.js');
}

const canvas = document.getElementById('gl');
const gl = canvas.getContext('webgl2', { antialias: true });
if (!gl) {
  statusBox.innerHTML = '<b>WebGL2 unavailable</b> in this browser.';
  throw new Error('WebGL2 unavailable');
}

// ---------- Shaders ----------

const VERTEX_SHADER = `#version 300 es
in vec3 aPos;     // point on the face plane (inside the unit sphere)
in vec3 aNormal;  // face normal, for lighting and the explode offset
in float aEdge;   // 1 at the face centre, 0 on its outline: distance-to-edge for drawing the edges
uniform mat3 uRot;
uniform float uExplode, uScale;
out vec3 vDir;
out float vEdge, vLight;
void main() {
  vDir = aPos;
  vEdge = aEdge;
  vec3 n = uRot * aNormal;
  vLight = 0.6 + 0.4 * max(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0);
  vec3 p = uRot * (aPos + aNormal * uExplode);
  gl_Position = vec4(p.xy * uScale, -p.z * 0.4, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vDir;
in float vEdge, vLight;
uniform sampler2D uEarth;
uniform float uEdges;
out vec4 outColor;
const float PI = 3.14159265358979;
const float MAX_LAT = 1.48442223;  // 85.0511°: Web Mercator stops here, the texture's edge row covers the caps
void main() {
  // Gnomonic projection: the face point stands for the place in its direction from the Earth's centre.
  vec3 d = normalize(vDir);
  float lat = clamp(asin(clamp(d.z, -1.0, 1.0)), -MAX_LAT, MAX_LAT);
  float lng = atan(d.y, d.x);
  vec2 uv = vec2(lng / (2.0 * PI) + 0.5, 0.5 - log(tan(PI / 4.0 + lat / 2.0)) / (2.0 * PI));

  // Texture gradients without the jump at ±180° (u wraps 1 → 0), which would pick the blurriest mipmap there:
  // take each derivative from u or from a copy whose seam sits at 0° instead, whichever is smaller.
  float u2 = fract(uv.x + 0.5);
  float dux = dFdx(uv.x), duy = dFdy(uv.x), du2x = dFdx(u2), du2y = dFdy(u2);
  vec2 gx = vec2(abs(du2x) < abs(dux) ? du2x : dux, dFdx(uv.y));
  vec2 gy = vec2(abs(du2y) < abs(duy) ? du2y : duy, dFdy(uv.y));
  vec3 color = textureGrad(uEarth, uv, gx, gy).rgb * vLight;

  // Face outline: vEdge falls to 0 on the outline; fwidth keeps the line ~1.3 px wide at any size.
  float line = 1.0 - smoothstep(0.0, fwidth(vEdge) * 1.3, vEdge);
  outColor = vec4(mix(color, vec3(0.03, 0.05, 0.09), line * uEdges), 1.0);
}`;

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

const program = gl.createProgram();
gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
gl.useProgram(program);
const uniform = Object.fromEntries(['uRot', 'uExplode', 'uScale', 'uEarth', 'uEdges'].map(u => [u, gl.getUniformLocation(program, u)]));

// ---------- Geometry ----------

// Each face as a triangle fan around its centre; interleaved [pos(3), normal(3), edge(1)] per vertex.
function buildMesh({ faces }) {
  const data = [];
  for (const { n, verts } of faces) {
    const centre = v3scale(verts.reduce(v3add), 1 / verts.length);
    verts.forEach((v, i) => {
      const w = verts[(i + 1) % verts.length];
      data.push(...centre, ...n, 1, ...v, ...n, 0, ...w, ...n, 0);
    });
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  [['aPos', 3, 0], ['aNormal', 3, 3], ['aEdge', 1, 6]].forEach(([name, size, offset]) => {
    const loc = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 7 * 4, offset * 4);
  });
  return { vao, count: data.length / 7 };
}

const meshes = SOLIDS.map(buildMesh);

// ---------- Earth texture ----------

const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([40, 70, 110, 255]));
const aniso = gl.getExtension('EXT_texture_filter_anisotropic');

const loadImage = src => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';  // Mapbox sends CORS headers; without this the texture upload is refused
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`tile failed: ${src.split('?')[0]}`));
  img.src = src;
});

// Stitch the 4 × 4 Web Mercator tiles into one canvas and upload it as the Earth texture.
async function loadEarth() {
  try {
    const n = 2 ** TILE_ZOOM, mosaic = document.createElement('canvas');
    mosaic.width = mosaic.height = n * TILE_SIZE;
    const ctx = mosaic.getContext('2d');
    const jobs = [];
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
      const url = `https://api.mapbox.com/styles/v1/${STYLE}/tiles/${TILE_SIZE}/${TILE_ZOOM}/${x}/${y}?access_token=${MAPBOX_TOKEN}`;
      jobs.push(loadImage(url).then(img => ctx.drawImage(img, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE)));
    }
    await Promise.all(jobs);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mosaic);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);         // longitude wraps around
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);  // beyond ±85° reuse the edge row
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    statusBox.innerHTML = `<b>${SOLIDS.length} solids</b>, from ${SOLIDS[0].faces.length} to ${SOLIDS.at(-1).faces.length} faces
      <br><span class="sub">Map © Mapbox © OpenStreetMap</span>`;
  } catch (err) {
    statusBox.innerHTML = `<b>Map failed to load</b><br><span class="sub">${err.message}</span>`;
  }
}

// ---------- Rotation ----------

const matMul = (A, B) => A.map(row => [0, 1, 2].map(j => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
const rotX = a => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const rotY = a => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const rotZ = a => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];

// World → view (x right, y up, z towards the viewer). Start with (lat 0, lng 0) facing us and north up,
// then tilt the North Pole slightly towards the viewer and turn to show Europe/Africa.
let rotation = matMul(rotX(0.35), matMul([[0, 1, 0], [0, 0, 1], [1, 0, 0]], rotZ(-15 * DEG)));

let drag = null;
canvas.addEventListener('pointerdown', e => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const k = 0.006;
  rotation = matMul(rotX((e.clientY - drag.y) * k), matMul(rotY((e.clientX - drag.x) * k), rotation));
  drag = { x: e.clientX, y: e.clientY };
});
const endDrag = () => { drag = null; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---------- Layout ----------

const labels = document.getElementById('labels');
let cells = [];

// 3 × 3 grid right of the panel; each solid drawn in a square viewport with its label underneath.
function layout() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  const left = innerWidth > 900 ? PANEL_WIDTH : 0;
  const cols = 3, rows = Math.ceil(SOLIDS.length / cols), labelH = 40;
  const cw = (innerWidth - left - 16) / cols, ch = (innerHeight - 16) / rows;
  const size = Math.min(cw, ch - labelH) * 0.94;
  labels.innerHTML = '';
  cells = SOLIDS.map((s, i) => {
    const cx = left + cw * (i % cols + 0.5), top = 8 + ch * Math.floor(i / cols) + (ch - labelH - size) / 2;
    const label = document.createElement('div');
    label.className = 'cell-label';
    label.style.left = `${cx}px`;
    label.style.top = `${top + size + 4}px`;
    label.innerHTML = `<b>${s.faces.length} faces</b> · ${s.name}<br>
      <span>coverage ${(s.coverage * 100).toFixed(1)}% · stretch ×${s.stretch < 10 ? s.stretch.toFixed(2) : s.stretch.toFixed(0)}</span>`;
    labels.appendChild(label);
    return { x: (cx - size / 2) * dpr, y: canvas.height - (top + size) * dpr, size: size * dpr };
  });
}
addEventListener('resize', layout);
layout();

// ---------- Render loop ----------

const explodeInput = document.getElementById('explode'), spinInput = document.getElementById('spin'), edgesInput = document.getElementById('edges');

gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);  // convex solids: dropping back faces is all the hidden-surface removal needed
gl.clearColor(0, 0, 0, 0);

let last = performance.now();
function frame(now) {
  const dt = Math.min(now - last, 100) / 1000;
  last = now;
  if (spinInput.checked && !drag) rotation = matMul(rotation, rotZ(dt * 0.25));  // turn the Earth eastwards

  const explode = parseFloat(explodeInput.value);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniformMatrix3fv(uniform.uRot, true, rotation.flat());  // WebGL2 accepts row-major with transpose = true
  gl.uniform1f(uniform.uExplode, explode);
  gl.uniform1f(uniform.uScale, 0.97 / (1 + explode));
  gl.uniform1i(uniform.uEarth, 0);
  meshes.forEach((mesh, i) => {
    const { x, y, size } = cells[i];
    gl.viewport(x, y, size, size);
    gl.uniform1f(uniform.uEdges, edgesInput.checked && SOLIDS[i].faces.length < 1000 ? 0.85 : 0);  // 5120 faces: just the sphere
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

loadEarth();
