// Two synced data views: a globe (left) and a Mercator map (right). Depends on geo.js and config.js (MAPBOX_TOKEN).
const BLUE = '#3fa9ff', RED = '#ff4d6d';
const MAX_POINTS = 2;
const points = [];

const fmt = ({ lat, lng }) =>
  `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(3)}°${lng >= 0 ? 'E' : 'W'}`;

const featureCollection = features => ({ type: 'FeatureCollection', features });

if (!window.MAPBOX_TOKEN) {
  document.getElementById('token-warning').hidden = false;
  throw new Error('Missing MAPBOX_TOKEN in config.js');
}
mapboxgl.accessToken = MAPBOX_TOKEN;

// ---------- Maps ----------

let data = { points: featureCollection([]), arc: featureCollection([]) };
let dragging = null;  // index of the point being dragged, shared by both maps

function createMap(container, projection, options) {
  const map = new mapboxgl.Map({ container, style: 'mapbox://styles/mapbox/streets-v12', projection, ...options });
  map.addControl(new mapboxgl.NavigationControl(), 'top-right');

  map.on('style.load', () => {
    if (projection === 'globe') map.setFog({ 'horizon-blend': 0.05, 'space-color': '#05070d', 'star-intensity': 0.4 });
    for (const [id, fc] of Object.entries(data)) map.addSource(id, { type: 'geojson', data: fc, lineMetrics: id === 'arc' });

    map.addLayer({
      id: 'arc', type: 'line', source: 'arc',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 3, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, BLUE, 1, RED] },
    });
    map.addLayer({
      id: 'points', type: 'circle', source: 'points',
      paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' },
    });
    map.addLayer({
      id: 'point-labels', type: 'symbol', source: 'points',
      layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, -1.4], 'text-allow-overlap': true },
      paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1.2 },
    });
  });

  map.on('click', e => {
    const hit = map.queryRenderedFeatures(e.point, { layers: ['points'] })[0];
    if (hit) { points.splice(hit.properties.i, 1); update(); }
    else addPoint({ lat: e.lngLat.lat, lng: e.lngLat.wrap().lng });
  });

  const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
  map.on('mouseenter', 'points', e => {
    if (dragging !== null) return;
    map.getCanvas().style.cursor = 'grab';
    popup.setLngLat(e.features[0].geometry.coordinates).setHTML(e.features[0].properties.label).addTo(map);
  });
  map.on('mouseleave', 'points', () => { if (dragging === null) map.getCanvas().style.cursor = ''; popup.remove(); });

  // Drag a point: press on it, move, release. preventDefault() stops the map from panning meanwhile.
  // (A press + release without moving still counts as a click, which removes the point.)
  let frame = null;
  const onMove = e => {
    const { lat, lng } = e.lngLat.wrap();
    points[dragging] = { lat, lng };
    frame ??= requestAnimationFrame(() => { frame = null; update(); });
  };
  const onUp = () => {
    dragging = null;
    frameArc();
    map.getCanvas().style.cursor = '';
    map.off('mousemove', onMove).off('touchmove', onMove);
  };
  const onDown = e => {
    if (e.points && e.points.length !== 1) return;  // ignore pinch-zoom
    e.preventDefault();
    dragging = e.features[0].properties.i;
    popup.remove();
    map.getCanvas().style.cursor = 'grabbing';
    map.on(e.type === 'touchstart' ? 'touchmove' : 'mousemove', onMove);
    map.once(e.type === 'touchstart' ? 'touchend' : 'mouseup', onUp);
  };
  map.on('mousedown', 'points', onDown);
  map.on('touchstart', 'points', onDown);

  return map;
}

const maps = [
  createMap('globe', 'globe', { center: [2.35, 30], zoom: 1.6 }),
  createMap('flat', 'mercator', { center: [0, 20], zoom: 0.6 }),
];

// ---------- Camera ----------

const PADDING = {
  globe: { top: 60, bottom: 60, left: 330, right: 60 },  // left side is covered by the panel
  flat: { top: 50, bottom: 50, left: 50, right: 50 },
};

// Zoom level for the globe, given the arc's central angle θ (radians) and the zoom that would fit its bounding box.
function globeZoom(θ, fitZoom) {
  // TODO(human)
  return fitZoom;
}

// Move both cameras so A, B and the arc are in view.
function frameArc() {
  if (points.length !== 2) return;
  const arc = greatCircle(points[0], points[1]);
  const bounds = arc.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(arc[0], arc[0]));
  const [globe, flat] = maps;

  flat.fitBounds(bounds, { padding: PADDING.flat, maxZoom: 12, duration: 1000 });

  // On the globe, centre on the arc's midpoint (bounding-box centres are meaningless for long arcs).
  const fit = globe.cameraForBounds(bounds, { padding: PADDING.globe, maxZoom: 12 });
  const θ = angle(points[0], points[1]);
  globe.easeTo({
    center: arc[Math.floor(arc.length / 2)],
    zoom: globeZoom(θ, fit?.zoom ?? 1.5),
    padding: PADDING.globe,
    duration: 1000,
  });
}

// ---------- Points ----------

// Called for every new point (map click, "+ Add"). Once A and B exist, they are moved by dragging instead.
function addPoint(p) {
  if (points.length >= MAX_POINTS) return;
  points.push(p);
  update();
  frameArc();
}

// ---------- Rendering ----------

// Full refresh: maps + table. Use after adding/removing points.
function update() {
  renderScene();
  renderTable();
}

function renderScene() {
  const names = ['A', 'B'];
  data = {
    points: featureCollection(points.map((p, i) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { i, name: names[i], color: i === 0 ? BLUE : RED, label: `${names[i]} · ${fmt(p)}<br><i>click to remove</i>` },
    }))),
    arc: featureCollection(points.length === 2
      ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: greatCircle(points[0], points[1]) }, properties: {} }]
      : []),
  };
  for (const map of maps) for (const [id, fc] of Object.entries(data)) map.getSource(id)?.setData(fc);

  const box = document.getElementById('arc');
  if (points.length < 2) box.textContent = `Add ${2 - points.length} more point${points.length ? '' : 's'} to draw the great-circle arc.`;
  else {
    const θ = angle(points[0], points[1]);
    box.innerHTML = `<b>Great-circle distance</b> ${Math.round(θ * EARTH_RADIUS_KM).toLocaleString('en')} km<br>
      <span class="sub">Central angle ${(θ / DEG).toFixed(2)}°</span>`;
  }
  document.getElementById('add').disabled = points.length >= MAX_POINTS;
}

const LIMITS = { lat: 90, lng: 180 };
let frameTimer;  // reframe once typing pauses, not on every keystroke

function renderTable() {
  const tbody = document.getElementById('rows');
  tbody.innerHTML = '';
  points.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${'AB'[i]}</td>
      <td><input type="number" step="any" min="-90" max="90" data-key="lat" value="${p.lat.toFixed(4)}"></td>
      <td><input type="number" step="any" min="-180" max="180" data-key="lng" value="${p.lng.toFixed(4)}"></td>
      <td><button title="Remove">✕</button></td>`;
    // Editing only redraws the maps, so the table (and input focus) is left untouched while typing.
    tr.querySelectorAll('input').forEach(input => input.addEventListener('input', () => {
      const key = input.dataset.key, v = parseFloat(input.value);
      const ok = Number.isFinite(v) && Math.abs(v) <= LIMITS[key];
      input.classList.toggle('invalid', !ok);
      if (ok) { p[key] = v; renderScene(); clearTimeout(frameTimer); frameTimer = setTimeout(frameArc, 600); }
    }));
    tr.querySelector('button').onclick = () => { points.splice(i, 1); update(); };
    tbody.appendChild(tr);
  });
}

// Uniform on the sphere (not uniform in lat/lng)
const randomPoint = () => ({ lat: Math.asin(2 * Math.random() - 1) / DEG, lng: Math.random() * 360 - 180 });

document.getElementById('add').onclick = () => addPoint({ lat: 0, lng: 0 });
document.getElementById('random').onclick = () => { points.length = 0; points.push(randomPoint(), randomPoint()); update(); frameArc(); };
document.getElementById('clear').onclick = () => { points.length = 0; update(); };

update();
