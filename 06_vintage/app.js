// Day 6 · Vintage: the Day 1–2 globe restyled as an old map, with France's 18th–19th century surveys on top.
// Depends on utils/*.js.

const PALETTE = {
  paper: '#efe3c2', paperDark: '#e2d1a3', land: '#e6d6a8', green: '#d9d3a0',
  water: '#c4cdb4', waterInk: '#6d7f74', ink: '#4a3218', road: '#9a7a4e', border: '#8a3b12',
};

// Scanned historical maps served by the IGN Géoplateforme as Web Mercator WMTS tiles (no key needed).
const wmts = (layer, format) => 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  `&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${format}`;
const FRANCE = [-5.5, 41.2, 9.8, 51.2];

const MODES = {
  parchment: {
    title: 'Parchment', when: 'the whole world',
    about: `<b>Ink on parchment</b><br><span class="sub">Today's Mapbox vector tiles redrawn in an
      old-atlas palette, with a 15° graticule, the tropics and the polar circles.</span>`,
  },
  cassini: {
    title: 'Cassini', when: '1756–1815', layer: 'cassini', fly: { center: [2.35, 48.85], zoom: 9 },
    about: `<b>Carte de Cassini</b><br><span class="sub">181 sheets at 1:86,400, surveyed by four generations of
      the Cassini family from a nationwide triangulation. Woods, parishes, mills, and gallows are hand-drawn.
      Zoom in from level 6.</span>`,
  },
  etatmajor: {
    title: 'État-major', when: '1820–1866', layer: 'etatmajor', fly: { center: [6.87, 45.92], zoom: 11 },
    about: `<b>Carte d'état-major</b><br><span class="sub">The army's 1:40,000 survey that replaced Cassini,
      shown here in its coloured edition: relief drawn with hachures, forests in green, water in blue.</span>`,
  },
  sepia: {
    title: 'Sepia photo', when: 'satellite', layer: 'satellite', sepia: true,
    about: `<b>Sepia satellite</b><br><span class="sub">Modern imagery toned like an albumen print,
      the way 1850s aerial photographs from balloons looked (a CSS <code>sepia()</code> filter on the canvas).</span>`,
  },
};

const RASTERS = {
  cassini: { tiles: [wmts('BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI', 'image/png')], bounds: FRANCE,
             minzoom: 6, maxzoom: 14, attribution: '© BnF / IGN — Carte de Cassini' },
  etatmajor: { tiles: [wmts('GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40', 'image/jpeg')], bounds: FRANCE,
               minzoom: 6, maxzoom: 15, attribution: '© IGN — Carte d\'état-major' },
  satellite: { url: 'mapbox://mapbox.satellite' },
};

let mode = 'parchment';
let opacity = 1;
let styleReady = false;  // raster layers exist (set in onStyleLoad)
const tileErrors = new Set();  // raster layers whose tiles failed to load (wrong id, service down…)

// ---------- Map ----------

const map = createMap('map', {
  style: 'mapbox://styles/mapbox/light-v11',
  center: [2.35, 30], zoom: 1.6,
  onStyleLoad: map => {
    map.setFog({
      color: PALETTE.paper, 'high-color': '#c8ab78', 'horizon-blend': 0.08,
      'space-color': '#2a1d10', 'star-intensity': 0,
    });
    vintagize(map);

    // Historical rasters go under the labels; the graticule goes on top of everything.
    const firstSymbol = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
    for (const [id, source] of Object.entries(RASTERS)) {
      map.addSource(id, { type: 'raster', tileSize: 256, ...source });
      map.addLayer({ id, type: 'raster', source: id, layout: { visibility: 'none' },
                     paint: { 'raster-fade-duration': 200 } }, firstSymbol);
    }
    addSources(map, { graticule: graticule() });
    map.addLayer({ id: 'graticule', type: 'line', source: 'graticule', filter: ['!', ['get', 'special']],
                   paint: { 'line-color': PALETTE.border, 'line-width': 0.6, 'line-opacity': 0.45 } });
    map.addLayer({ id: 'graticule-special', type: 'line', source: 'graticule', filter: ['get', 'special'],
                   paint: { 'line-color': PALETTE.border, 'line-width': 1.2, 'line-opacity': 0.8, 'line-dasharray': [6, 3] } });
    styleReady = true;
    render();
  },
});

map.on('error', e => {
  const id = e.sourceId ?? e.source?.id;
  if (id in RASTERS && !tileErrors.has(id)) { tileErrors.add(id); render(); }
});

// Rewrite every layer of the modern style in an old-atlas palette.
function vintagize(map) {
  const set = (id, prop, value) => { try { map.setPaintProperty(id, prop, value); } catch { /* prop n/a */ } };
  for (const { id, type, layout = {} } of map.getStyle().layers) {
    const water = /water|ocean|river|lake/.test(id);
    if (type === 'background') set(id, 'background-color', PALETTE.paper);
    else if (type === 'fill') {
      set(id, 'fill-color', water ? PALETTE.water : /park|wood|national|landcover/.test(id) ? PALETTE.green
        : /building|structure/.test(id) ? PALETTE.paperDark : PALETTE.land);
      set(id, 'fill-opacity', /building/.test(id) ? 0.5 : 1);
    } else if (type === 'line') {
      set(id, 'line-color', water ? PALETTE.waterInk : /admin|boundary/.test(id) ? PALETTE.border : PALETTE.road);
    } else if (type === 'symbol') {
      set(id, 'text-color', water ? PALETTE.waterInk : PALETTE.ink);
      set(id, 'text-halo-color', PALETTE.paper);
      if (layout['icon-image']) set(id, 'icon-opacity', 0);  // modern POI pictograms don't belong here
    } else if (type === 'fill-extrusion') map.setLayoutProperty(id, 'visibility', 'none');
  }

  // Inked coastline with a soft wash along it, the way engravers shaded shores.
  const before = map.getStyle().layers.find(l => l.type === 'line' || l.type === 'symbol')?.id;
  for (const [suffix, paint] of [
    ['wash', { 'line-color': PALETTE.waterInk, 'line-width': 7, 'line-blur': 6, 'line-opacity': 0.35 }],
    ['ink', { 'line-color': PALETTE.ink, 'line-width': 0.8 }],
  ]) map.addLayer({ id: `coast-${suffix}`, type: 'line', source: 'composite', 'source-layer': 'water', paint }, before);
}

// Meridians and parallels every 15°, plus the equator, tropics and polar circles (dashed, `special`).
function graticule() {
  const range = (a, b, step) => Array.from({ length: Math.round((b - a) / step) + 1 }, (_, i) => a + i * step);
  const meridian = lng => lineFeature(range(-80, 80, 2).map(lat => [lng, lat]), { special: false });
  const parallel = (lat, special) => lineFeature(range(-180, 180, 2).map(lng => [lng, lat]), { special });
  const TILT = 23.44;
  return featureCollection([
    ...range(-180, 165, 15).map(meridian),
    ...range(-75, 75, 15).filter(lat => lat !== 0).map(lat => parallel(lat, false)),
    ...[0, TILT, -TILT, 90 - TILT, TILT - 90].map(lat => parallel(lat, true)),
  ]);
}

// ---------- Rendering ----------

function render() {
  const current = MODES[mode];
  document.body.classList.toggle('sepia', !!current.sepia);
  if (styleReady) for (const id of Object.keys(RASTERS)) {
    map.setLayoutProperty(id, 'visibility', id === current.layer ? 'visible' : 'none');
    map.setPaintProperty(id, 'raster-opacity', opacity);
  }

  document.getElementById('opacity-row').style.display = current.layer ? '' : 'none';
  const warning = tileErrors.has(current.layer)
    ? `<br><span class="sub">⚠ Some tiles failed to load from ${current.layer === 'satellite' ? 'Mapbox' : 'the IGN Géoplateforme'}.</span>` : '';
  document.getElementById('about').innerHTML = current.about + warning;
  for (const button of document.querySelectorAll('#modes button')) button.classList.toggle('active', button.dataset.mode === mode);
}

function setMode(next) {
  mode = next;
  render();
  if (MODES[mode].fly) map.flyTo({ ...MODES[mode].fly, padding: PANEL_PADDING, duration: 4000, essential: true });
}

document.getElementById('modes').innerHTML = Object.entries(MODES)
  .map(([id, m]) => `<button data-mode="${id}">${m.title}<small>${m.when}</small></button>`).join('');
document.getElementById('modes').onclick = e => {
  const button = e.target.closest('button');
  if (button) setMode(button.dataset.mode);
};
document.getElementById('opacity').oninput = e => { opacity = +e.target.value; render(); };

render();
