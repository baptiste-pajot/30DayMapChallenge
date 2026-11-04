// Shared Mapbox map + side-panel helpers. Depends on utils/config.js (MAPBOX_TOKEN) and utils/geo.js.

const fmt = ({ lat, lng }) =>
  `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(3)}°${lng >= 0 ? 'E' : 'W'}`;

const featureCollection = features => ({ type: 'FeatureCollection', features });
const pointFeature = ({ lat, lng }, properties = {}) =>
  ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties });
const lineFeature = (coordinates, properties = {}) =>
  ({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties });

if (!window.MAPBOX_TOKEN) {
  const warning = document.createElement('div');
  warning.id = 'token-warning';
  warning.innerHTML = `<b>Mapbox token missing.</b> Copy <code>utils/config.example.js</code> to
    <code>utils/config.js</code> and set <code>MAPBOX_TOKEN</code> to your public token (<code>pk.…</code>).`;
  document.body.appendChild(warning);
  throw new Error('Missing MAPBOX_TOKEN in utils/config.js');
}
mapboxgl.accessToken = MAPBOX_TOKEN;

// Map with the shared style (plus space fog on the globe). `onStyleLoad(map)` adds the day's sources and layers:
// layers must be (re)added on 'style.load', after the style has finished loading.
function createMap(container, { projection = 'globe', onStyleLoad, ...options } = {}) {
  const map = new mapboxgl.Map({ container, style: 'mapbox://styles/mapbox/streets-v12', projection, ...options });
  map.addControl(new mapboxgl.NavigationControl(), 'top-right');
  map.on('style.load', () => {
    if (projection === 'globe') map.setFog({ 'horizon-blend': 0.05, 'space-color': '#05070d', 'star-intensity': 0.4 });
    onStyleLoad?.(map);
  });
  return map;
}

// One GeoJSON source per entry of `data` ({ sourceId: FeatureCollection }). lineMetrics enables 'line-gradient'.
function addSources(map, data) {
  for (const [id, fc] of Object.entries(data)) map.addSource(id, { type: 'geojson', data: fc, lineMetrics: true });
}

function setSources(maps, data) {
  for (const map of maps) for (const [id, fc] of Object.entries(data)) map.getSource(id)?.setData(fc);
}

// Shared look for the clickable point markers and their text labels.
function addPointLayers(map, source, { color, radius = 6, text }) {
  map.addLayer({
    id: source, type: 'circle', source,
    paint: { 'circle-radius': radius, 'circle-color': color, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' },
  });
  map.addLayer({
    id: `${source}-labels`, type: 'symbol', source,
    layout: { 'text-field': text, 'text-size': 11, 'text-offset': [0, -1.4], 'text-allow-overlap': true },
    paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1.2 },
  });
}

// Click on a feature of `layer` → onRemove(its `i` property); click anywhere else → onAdd({ lat, lng }).
function onMapClick(map, layer, { onAdd, onRemove }) {
  map.on('click', e => {
    const hit = map.queryRenderedFeatures(e.point, { layers: [layer] })[0];
    if (hit) onRemove(hit.properties.i);
    else onAdd({ lat: e.lngLat.lat, lng: e.lngLat.wrap().lng });
  });
}

// Hover tooltip showing each feature's `label` property. `enabled()` lets callers pause it (e.g. while dragging).
function addHoverPopup(map, layers, { cursor = 'pointer', enabled = () => true } = {}) {
  const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
  for (const layer of layers) {
    map.on('mouseenter', layer, e => {
      if (!enabled()) return;
      map.getCanvas().style.cursor = cursor;
      popup.setLngLat(e.features[0].geometry.coordinates).setHTML(e.features[0].properties.label).addTo(map);
    });
    map.on('mouseleave', layer, () => {
      if (enabled()) map.getCanvas().style.cursor = '';
      popup.remove();
    });
  }
  return popup;
}

// ---------- Camera ----------

const PANEL_PADDING = { top: 60, bottom: 60, left: 330, right: 60 };  // left side is covered by #panel

const debounce = (fn, ms) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };

// Zoom level for a globe view, given the angular size `extent` (radians, 0…2π) of what must be visible
// and `fitZoom`, the zoom that would fit its lng/lat bounding box.
function globeZoom(extent, fitZoom) {
  // TODO(human)
  return fitZoom;
}

// Ease a globe camera onto `center` ({ lat, lng }) so every [lng, lat] in `coords` is in view.
function frameGlobe(map, { center, coords, extent, padding = PANEL_PADDING, duration = 1000 }) {
  // Bring longitudes within ±180° of the centre, so lines unwrapped differently still give a tight box.
  const near = coords.map(([lng, lat]) => [lng + 360 * Math.round((center.lng - lng) / 360), lat]);
  const bounds = near.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(near[0], near[0]));
  const fit = map.cameraForBounds(bounds, { padding, maxZoom: 12 });
  map.easeTo({ center: [center.lng, center.lat], zoom: globeZoom(extent, fit?.zoom ?? 1.5), padding, duration });
}

// ---------- Coordinate table ----------

const LIMITS = { lat: 90, lng: 180 };

// Editable lat/lng table. Typing a valid value mutates the point and calls onEdit() — the table itself isn't
// rebuilt, so the input keeps focus; out-of-range values are highlighted and ignored. ✕ calls onRemove(i).
function renderCoordTable(tbody, points, { label = i => i + 1, onEdit, onRemove }) {
  tbody.innerHTML = '';
  points.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${label(i)}</td>
      <td><input type="number" step="any" min="-90" max="90" data-key="lat" value="${p.lat.toFixed(4)}"></td>
      <td><input type="number" step="any" min="-180" max="180" data-key="lng" value="${p.lng.toFixed(4)}"></td>
      <td><button title="Remove">✕</button></td>`;
    tr.querySelectorAll('input').forEach(input => input.addEventListener('input', () => {
      const key = input.dataset.key, v = parseFloat(input.value);
      const ok = Number.isFinite(v) && Math.abs(v) <= LIMITS[key];
      input.classList.toggle('invalid', !ok);
      if (ok) { p[key] = v; onEdit(); }
    }));
    tr.querySelector('button').onclick = () => onRemove(i);
    tbody.appendChild(tr);
  });
}
