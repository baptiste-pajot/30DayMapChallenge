// Map, layers and side panel. Depends on geo.js and config.js (MAPBOX_TOKEN).
const RED = '#ff4d6d', YELLOW = '#ffc400';
const points = [];

const fmt = ({ lat, lng }) =>
  `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(3)}°${lng >= 0 ? 'E' : 'W'}`;

const featureCollection = features => ({ type: 'FeatureCollection', features });
const pointFeature = ({ lat, lng }, properties = {}) =>
  ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties });

if (!window.MAPBOX_TOKEN) {
  document.getElementById('token-warning').hidden = false;
  throw new Error('Missing MAPBOX_TOKEN in config.js');
}
mapboxgl.accessToken = MAPBOX_TOKEN;

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  projection: 'globe',
  center: [2.35, 30],
  zoom: 1.6,
});
map.addControl(new mapboxgl.NavigationControl(), 'top-right');

// ---------- Layers ----------

let data = { points: featureCollection([]), centroid: featureCollection([]), ties: featureCollection([]), lines: featureCollection([]) };

function addLayers() {
  map.setFog({ 'horizon-blend': 0.05, 'space-color': '#05070d', 'star-intensity': 0.4 });

  for (const [id, fc] of Object.entries(data)) {
    map.addSource(id, { type: 'geojson', data: fc, lineMetrics: id === 'lines' });
  }

  map.addLayer({
    id: 'lines', type: 'line', source: 'lines',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': 2.5,
      'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, RED, 1, YELLOW],
    },
  });
  map.addLayer({
    id: 'ties', type: 'circle', source: 'ties',
    paint: { 'circle-radius': ['get', 'radius'], 'circle-color': YELLOW, 'circle-stroke-width': 1, 'circle-stroke-color': '#000' },
  });
  map.addLayer({
    id: 'centroid-pulse', type: 'circle', source: 'centroid',
    paint: { 'circle-radius': 10, 'circle-color': YELLOW, 'circle-opacity': 0.4 },
  });
  map.addLayer({
    id: 'centroid', type: 'circle', source: 'centroid',
    paint: { 'circle-radius': 8, 'circle-color': YELLOW, 'circle-stroke-width': 2, 'circle-stroke-color': '#000' },
  });
  map.addLayer({
    id: 'points', type: 'circle', source: 'points',
    paint: { 'circle-radius': 6, 'circle-color': RED, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' },
  });
  map.addLayer({
    id: 'point-labels', type: 'symbol', source: 'points',
    layout: { 'text-field': ['to-string', ['get', 'n']], 'text-size': 11, 'text-offset': [0, -1.4], 'text-allow-overlap': true },
    paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1.2 },
  });
}

map.on('style.load', addLayers);

// Pulsing halo around the centroid.
(function pulse(t) {
  const k = (t % 1500) / 1500;
  if (map.getLayer('centroid-pulse')) {
    map.setPaintProperty('centroid-pulse', 'circle-radius', 8 + 22 * k);
    map.setPaintProperty('centroid-pulse', 'circle-opacity', 0.5 * (1 - k));
  }
  requestAnimationFrame(pulse);
})(0);

// ---------- Interaction ----------

map.on('click', e => {
  const hit = map.queryRenderedFeatures(e.point, { layers: ['points'] })[0];
  if (hit) points.splice(hit.properties.i, 1);
  else points.push({ lat: e.lngLat.lat, lng: e.lngLat.wrap().lng });
  update();
});

const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
for (const layer of ['points', 'centroid', 'ties']) {
  map.on('mouseenter', layer, e => {
    map.getCanvas().style.cursor = 'pointer';
    popup.setLngLat(e.features[0].geometry.coordinates).setHTML(e.features[0].properties.label).addTo(map);
  });
  map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; popup.remove(); });
}

// ---------- Rendering ----------

// Full refresh: map + table. Use after adding/removing points.
function update() {
  renderScene();
  renderTable();
}

function renderScene() {
  const c = sphericalCentroid(points);
  const ties = !c && points.length ? tiedCentres(points) : [];

  data = {
    points: featureCollection(points.map((p, i) =>
      pointFeature(p, { i, n: i + 1, label: `#${i + 1} · ${fmt(p)}<br><i>click to remove</i>` }))),
    centroid: featureCollection(c ? [pointFeature(c, { label: `Centroid · ${fmt(c)}` })] : []),
    ties: featureCollection(ties.map(t => pointFeature(t, { radius: ties.length > 12 ? 2.5 : 7, label: `Tied centre · ${fmt(t)}` }))),
    lines: featureCollection(c && points.length > 1
      ? points.map(p => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: greatCircle(p, c) }, properties: {} }))
      : []),
  };
  for (const [id, fc] of Object.entries(data)) map.getSource(id)?.setData(fc);

  const box = document.getElementById('centroid');
  if (!points.length) box.textContent = 'Add points to compute the centroid.';
  else if (!c) box.innerHTML = `<b>No unique centre</b> — the points balance out, so their mean direction vanishes.<br>
    <span class="sub">${ties.length > 12
      ? 'Every point on the yellow line is an equally valid centre'
      : `${ties.length} equally valid centres (yellow)`}: they minimise the sum of squared great-circle distances.</span>`;
  else box.innerHTML = `<b>Centroid</b> ${fmt(c)}<br>
    <span class="sub">${points.length} point${points.length > 1 ? 's' : ''} · concentration ${(c.strength * 100).toFixed(1)}%</span>`;
}

const LIMITS = { lat: 90, lng: 180 };

function renderTable() {
  const tbody = document.getElementById('rows');
  tbody.innerHTML = '';
  points.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i + 1}</td>
      <td><input type="number" step="any" min="-90" max="90" data-key="lat" value="${p.lat.toFixed(4)}"></td>
      <td><input type="number" step="any" min="-180" max="180" data-key="lng" value="${p.lng.toFixed(4)}"></td>
      <td><button title="Remove">✕</button></td>`;
    // Editing only redraws the map, so the table (and input focus) is left untouched while typing.
    tr.querySelectorAll('input').forEach(input => input.addEventListener('input', () => {
      const key = input.dataset.key, v = parseFloat(input.value);
      const ok = Number.isFinite(v) && Math.abs(v) <= LIMITS[key];
      input.classList.toggle('invalid', !ok);
      if (ok) { p[key] = v; renderScene(); }
    }));
    tr.querySelector('button').onclick = () => { points.splice(i, 1); update(); };
    tbody.appendChild(tr);
  });
}

document.getElementById('undo').onclick = () => { points.pop(); update(); };
document.getElementById('clear').onclick = () => { points.length = 0; update(); };
document.getElementById('random').onclick = () => {
  for (let i = 0; i < 5; i++) {
    // Uniform on the sphere (not uniform in lat/lng)
    points.push({ lat: Math.asin(2 * Math.random() - 1) / DEG, lng: Math.random() * 360 - 180 });
  }
  update();
};

update();
