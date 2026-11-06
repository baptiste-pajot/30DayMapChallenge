// Day 4 · Clusters: OSM bars / schools / churches of France, clustered by Mapbox. Depends on utils/*.js (incl. overpass.js).

// Cluster size classes on point_count: [lower bound, radius px, fill opacity]. The first class starts at 2.
const CLUSTER_STEPS = [[2, 14, 0.55], [25, 20, 0.65], [250, 28, 0.75], [2500, 38, 0.85]];

let category = 'bars';
let data = { pois: featureCollection([]) };
let loadId = 0;  // ignore a slow response if the user has switched category since

const map = createMap('map', {
  style: 'mapbox://styles/mapbox/light-v11',
  projection: { name: 'lambertConformalConic', center: [2.5, 46.5], parallels: [44, 49] },
  bounds: [[-5.2, 41.3], [9.6, 51.1]],
  fitBoundsOptions: { padding: PANEL_PADDING },
  minZoom: 4,
  onStyleLoad: map => {
    // Not addSources(): clustering is an option of the source itself.
    map.addSource('pois', { type: 'geojson', data: data.pois, cluster: true, clusterRadius: 50, clusterMaxZoom: 14 });
    map.addLayer({
      id: 'clusters', type: 'circle', source: 'pois', filter: ['has', 'point_count'],
      paint: { 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' },
    });
    map.addLayer({
      id: 'cluster-count', type: 'symbol', source: 'pois', filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': ['step', ['get', 'point_count'], 11, 250, 13, 2500, 15],
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#10141c' },
    });
    map.addLayer({
      id: 'unclustered', type: 'circle', source: 'pois', filter: ['!', ['has', 'point_count']],
      paint: { 'circle-radius': 5, 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' },
    });
    styleLayers();
  },
});

// Size, opacity and colour of the layers for the current category.
function styleLayers() {
  if (!map.getLayer('clusters')) return;
  const color = CATEGORIES[category].color;
  const step = i => ['step', ['get', 'point_count'], CLUSTER_STEPS[0][i], ...CLUSTER_STEPS.slice(1).flatMap(s => [s[0], s[i]])];
  map.setPaintProperty('clusters', 'circle-color', color);
  map.setPaintProperty('clusters', 'circle-radius', step(1));
  map.setPaintProperty('clusters', 'circle-opacity', step(2));
  map.setPaintProperty('unclustered', 'circle-color', color);
}

// ---------- Interaction ----------

// Click a cluster → zoom to the level where it breaks apart.
map.on('click', 'clusters', e => {
  const f = e.features[0];
  map.getSource('pois').getClusterExpansionZoom(f.properties.cluster_id, (err, zoom) => {
    if (!err) map.easeTo({ center: f.geometry.coordinates, zoom, padding: PANEL_PADDING });
  });
});

const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
function hover(layer, html) {
  map.on('mouseenter', layer, e => {
    map.getCanvas().style.cursor = 'pointer';
    popup.setLngLat(e.features[0].geometry.coordinates).setHTML(html(e.features[0].properties)).addTo(map);
  });
  map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; popup.remove(); });
}
hover('clusters', p => `<b>${p.point_count.toLocaleString()}</b> ${CATEGORIES[category].label.toLowerCase()}<br><i>click to zoom in</i>`);
hover('unclustered', p => p.name ? escapeHtml(p.name) : '<i>unnamed</i>');

// ---------- Panel ----------

const statusBox = document.getElementById('status');
const setStatus = html => { statusBox.innerHTML = html; };

function renderPanel() {
  renderCategoryButtons(document.getElementById('categories'), category, select);
  statusBox.style.setProperty('--accent', CATEGORIES[category].color);
  const color = CATEGORIES[category].color;
  document.getElementById('scale').innerHTML = 'Cluster size:' + CLUSTER_STEPS.map(([n, r, o], i) => {
    const next = CLUSTER_STEPS[i + 1]?.[0];
    const d = Math.round(r * 0.6);
    return `<span><span class="dot" style="width:${d}px;height:${d}px;background:${color};opacity:${o}"></span>${
      next ? `${n}–${next - 1}` : `${n}+`}</span>`;
  }).join('');
}

// ---------- Loading ----------

async function select(key, { force = false } = {}) {
  category = key;
  const id = ++loadId;
  renderPanel();
  styleLayers();
  const label = CATEGORIES[key].label.toLowerCase();
  setStatus(`Loading ${label}…`);
  try {
    const { rows, date, source } = await loadCategory(key, {
      force,
      onAttempt: host => id === loadId && setStatus(`Querying <b>${host}</b> for ${label}…<br>
        <span class="sub">A live query takes 1–3 minutes.</span>`),
    });
    if (id !== loadId) return;
    data.pois = featureCollection(rows.map(([lng, lat, name]) => pointFeature({ lat, lng }, { name })));
    setSources([map], data);
    setStatus(`<b>${rows.length.toLocaleString()}</b> ${label} in OpenStreetMap<br><span class="sub">${
      source}, ${date}</span>`);
  } catch (err) {
    if (id !== loadId) return;
    setStatus(`<b>Overpass query failed.</b><br><span class="sub">${escapeHtml(err.message)}. The public servers
      are often busy, so try again in a minute.</span>`);
  }
}

document.getElementById('reload').onclick = () => select(category, { force: true });
select(category);
