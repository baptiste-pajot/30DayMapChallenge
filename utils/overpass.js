// OpenStreetMap points of interest in mainland France, via the Overpass API. Everything above the
// "Loading in the page" section is DOM-free, so fetch_osm.js (node) reuses it to write the local snapshot.

// Mainland France + Corsica. The bbox drops the overseas regions that the France boundary relation also contains.
const FRANCE_BBOX = [41.2, -5.6, 51.3, 9.8];  // south, west, north, east (Overpass order)

const CATEGORIES = {
  bars:     { label: 'Bars',     color: '#ff8c42', filter: '[amenity~"^(bar|pub)$"]' },
  schools:  { label: 'Schools',  color: '#3fa7ff', filter: '[amenity=school]' },
  churches: { label: 'Churches', color: '#b58cff', filter: '[amenity=place_of_worship][religion=christian]' },
};

// Several public instances: if one is busy (429/504), try the next one.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// `out center` turns ways/relations (a school drawn as a building outline) into one point. CSV keeps the
// download small: one "lat<TAB>lon<TAB>name" line per feature.
function buildQuery(filter) {
  return `[out:csv(::lat,::lon,name;false)][timeout:180][bbox:${FRANCE_BBOX.join(',')}];
area["ISO3166-1"="FR"][admin_level=2]->.fr;
nwr${filter}(area.fr);
out center qt;`;
}

// → [[lng, lat, name], …], coordinates rounded to ~1 m. Lines without coordinates are skipped.
function parseCsv(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const [lat, lon, ...name] = line.split('\t');
    const la = parseFloat(lat), lo = parseFloat(lon);
    if (Number.isFinite(la) && Number.isFinite(lo)) rows.push([+lo.toFixed(5), +la.toFixed(5), name.join(' ').trim()]);
  }
  return rows;
}

async function fetchOverpass(filter, { onAttempt, onError, headers = {} } = {}) {
  const body = 'data=' + encodeURIComponent(buildQuery(filter));
  let lastError;
  for (const url of OVERPASS_ENDPOINTS) {
    onAttempt?.(new URL(url).host);
    try {
      const res = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const rows = parseCsv(await res.text());
      if (!rows.length) throw new Error('empty result');
      return rows;
    } catch (err) {
      lastError = new Error(`${new URL(url).host}: ${err.message}`);
      onError?.(lastError);
    }
  }
  throw lastError;
}

// ---------- Loading in the page ----------

// Local snapshot written by utils/fetch_osm.js: utils/osm/<key>.js sets POIS.<key>. Injected as a <script> on demand
// (works from file://, unlike fetch); resolves to null if the file is missing.
const POIS = window.POIS = window.POIS || {};
function loadSnapshot(key) {
  if (POIS[key]) return Promise.resolve(POIS[key]);
  return new Promise(resolve => {
    const script = document.createElement('script');
    script.src = `../utils/osm/${key}.js`;  // relative to the day page
    script.onload = () => resolve(POIS[key] || null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

// Snapshot first; live Overpass when forced or when there is no snapshot (the result is kept in memory only).
async function loadCategory(key, { force = false, onAttempt } = {}) {
  const snap = !force && await loadSnapshot(key);
  if (snap?.rows?.length) return { rows: snap.rows, date: snap.date, source: 'local snapshot' };
  const rows = await fetchOverpass(CATEGORIES[key].filter, { onAttempt });
  POIS[key] = { date: new Date().toISOString().slice(0, 10), rows };
  return { rows, date: POIS[key].date, source: 'live Overpass query' };
}

// One button per category in `box`; the active one is highlighted with its colour. onSelect(key) on click.
function renderCategoryButtons(box, active, onSelect) {
  box.innerHTML = '';
  for (const [key, c] of Object.entries(CATEGORIES)) {
    const b = document.createElement('button');
    b.textContent = c.label;
    b.classList.toggle('active', key === active);
    b.style.setProperty('--accent', c.color);
    b.onclick = () => { if (key !== active) onSelect(key); };
    box.appendChild(b);
  }
}
