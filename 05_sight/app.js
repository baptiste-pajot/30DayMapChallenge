// Day 5 · Heatmap: the Day 4 OSM points (bars / schools / churches of France) as a Mapbox heatmap.
// Depends on utils/*.js (incl. overpass.js and the utils/osm/ snapshots).

const POINTS_ZOOM = 12;    // heatmap fades out and individual points fade in between this zoom and +2
const REF_COUNT = 25000;   // with "same total heat", every category weighs as much as 25 000 points

let category = 'bars';
let count = 0;             // number of points of the current category, for the normalised weight
let data = { pois: featureCollection([]) };
let loadId = 0;

const map = createMap('map', {
  style: 'mapbox://styles/mapbox/dark-v11',
  projection: { name: 'lambertConformalConic', center: [2.5, 46.5], parallels: [44, 49] },
  bounds: [[-5.2, 41.3], [9.6, 51.1]],
  fitBoundsOptions: { padding: PANEL_PADDING },
  minZoom: 4,
  onStyleLoad: map => {
    addSources(map, data);
    // Put the heat under the place labels so town names stay readable on top of it.
    const firstSymbol = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
    map.addLayer({
      id: 'heat', type: 'heatmap', source: 'pois', maxzoom: POINTS_ZOOM + 2,
      paint: {
        // Kernel radius in pixels: wide at country scale so neighbouring towns merge, narrower relative to the
        // map as you zoom in (one pixel covers less ground), so streets and districts separate.
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 7, 9, 10, 18, 14, 35],
        // Density multiplier: low at country scale where tens of thousands of points pile up.
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.25, 8, 0.8, 12, 2.5],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], POINTS_ZOOM, 0.9, POINTS_ZOOM + 2, 0],
      },
    }, firstSymbol);
    map.addLayer({
      id: 'points', type: 'circle', source: 'pois', minzoom: POINTS_ZOOM,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], POINTS_ZOOM, 2, 16, 6],
        'circle-stroke-width': 1, 'circle-stroke-color': '#10141c',
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], POINTS_ZOOM, 0, POINTS_ZOOM + 1.5, 1],
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], POINTS_ZOOM, 0, POINTS_ZOOM + 1.5, 1],
      },
    }, firstSymbol);
    styleLayers();
  },
});

// ---------- Colours ----------

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// Transparent → category colour → pale yellow → white: low density lets the dark basemap through,
// the hottest spots read as "glowing".
const rampStops = color => [
  [0, rgba(color, 0)], [0.1, rgba(color, 0.25)], [0.3, rgba(color, 0.55)], [0.55, rgba(color, 0.9)],
  [0.8, '#ffe08a'], [1, '#ffffff'],
];

function styleLayers() {
  if (!map.getLayer('heat')) return;
  const color = CATEGORIES[category].color;
  map.setPaintProperty('heat', 'heatmap-color', ['interpolate', ['linear'], ['heatmap-density'], ...rampStops(color).flat()]);
  const normalise = document.getElementById('normalise').checked;
  map.setPaintProperty('heat', 'heatmap-weight', normalise && count ? REF_COUNT / count : 1);
  map.setPaintProperty('points', 'circle-color', color);
}

// ---------- Panel ----------

const statusBox = document.getElementById('status');
const setStatus = html => { statusBox.innerHTML = html; };
const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function renderPanel() {
  renderCategoryButtons(document.getElementById('categories'), category, select);
  const color = CATEGORIES[category].color;
  statusBox.style.setProperty('--accent', color);
  document.getElementById('ramp').style.background =
    `linear-gradient(to right, ${rampStops(color).map(([t, c]) => `${c} ${t * 100}%`).join(', ')})`;
}

document.getElementById('normalise').onchange = styleLayers;
addHoverPopup(map, ['points']);

// ---------- Loading ----------

async function select(key) {
  category = key;
  const id = ++loadId;
  renderPanel();
  const label = CATEGORIES[key].label.toLowerCase();
  setStatus(`Loading ${label}…`);
  try {
    const { rows, date, source } = await loadCategory(key, {
      onAttempt: host => id === loadId && setStatus(`Querying <b>${host}</b> for ${label}…<br>
        <span class="sub">No local snapshot: a live query takes 1–3 minutes.</span>`),
    });
    if (id !== loadId) return;
    count = rows.length;
    data.pois = featureCollection(rows.map(([lng, lat, name]) =>
      pointFeature({ lat, lng }, { label: name ? escapeHtml(name) : '<i>unnamed</i>' })));
    setSources([map], data);
    styleLayers();
    setStatus(`<b>${rows.length.toLocaleString()}</b> ${label} in OpenStreetMap<br><span class="sub">${source}, ${date}</span>`);
  } catch (err) {
    if (id !== loadId) return;
    setStatus(`<b>Overpass query failed.</b><br><span class="sub">${escapeHtml(err.message)}</span>`);
  }
}

select(category);
