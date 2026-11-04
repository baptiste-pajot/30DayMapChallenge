// Day 2 · Lines: great-circle arc between two points, on a globe (left) and a Mercator map (right).
// Depends on utils/*.js.
const BLUE = '#3fa9ff', RED = '#ff4d6d';
const MAX_POINTS = 2;
const NAMES = ['A', 'B'];
const points = [];

let data = { points: featureCollection([]), arc: featureCollection([]) };
let dragging = null;  // index of the point being dragged, shared by both maps

function setupMap(container, projection, options) {
  const map = createMap(container, {
    projection,
    ...options,
    onStyleLoad: map => {
      addSources(map, data);
      map.addLayer({
        id: 'arc', type: 'line', source: 'arc',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 3, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, BLUE, 1, RED] },
      });
      addPointLayers(map, 'points', { color: ['get', 'color'], text: ['get', 'name'] });
    },
  });

  onMapClick(map, 'points', { onAdd: addPoint, onRemove: removePoint });
  const popup = addHoverPopup(map, ['points'], { cursor: 'grab', enabled: () => dragging === null });

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
  setupMap('globe', 'globe', { center: [2.35, 30], zoom: 1.6 }),
  setupMap('flat', 'mercator', { center: [0, 20], zoom: 0.6 }),
];

// ---------- Camera ----------

// Move both cameras so A, B and the arc are in view.
function frameArc() {
  if (points.length !== 2) return;
  const arc = greatCircle(points[0], points[1]);
  const bounds = arc.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(arc[0], arc[0]));
  const [globe, flat] = maps;

  flat.fitBounds(bounds, { padding: 50, maxZoom: 12, duration: 1000 });

  // On the globe, centre on the arc's midpoint (bounding-box centres are meaningless for long arcs).
  const [lng, lat] = arc[Math.floor(arc.length / 2)];
  frameGlobe(globe, { center: { lat, lng }, coords: arc, extent: angle(points[0], points[1]) });
}
const frameArcSoon = debounce(frameArc, 600);  // reframe once typing pauses, not on every keystroke

// ---------- Points ----------

// Called for every new point (map click, "+ Add"). Once A and B exist, they are moved by dragging instead.
function addPoint(p) {
  if (points.length >= MAX_POINTS) return;
  points.push(p);
  update();
  frameArc();
}

function removePoint(i) {
  points.splice(i, 1);
  update();
}

// ---------- Rendering ----------

// Full refresh: maps + table. Use after adding/removing points.
function update() {
  renderScene();
  renderCoordTable(document.getElementById('rows'), points, {
    label: i => NAMES[i],
    onEdit: () => { renderScene(); frameArcSoon(); },
    onRemove: removePoint,
  });
}

function renderScene() {
  data = {
    points: featureCollection(points.map((p, i) => pointFeature(p, {
      i, name: NAMES[i], color: i === 0 ? BLUE : RED, label: `${NAMES[i]} · ${fmt(p)}<br><i>click to remove</i>`,
    }))),
    arc: featureCollection(points.length === 2 ? [lineFeature(greatCircle(points[0], points[1]))] : []),
  };
  setSources(maps, data);

  const box = document.getElementById('arc');
  if (points.length < 2) box.textContent = `Add ${2 - points.length} more point${points.length ? '' : 's'} to draw the great-circle arc.`;
  else {
    const θ = angle(points[0], points[1]);
    box.innerHTML = `<b>Great-circle distance</b> ${Math.round(θ * EARTH_RADIUS_KM).toLocaleString('en')} km<br>
      <span class="sub">Central angle ${(θ / DEG).toFixed(2)}°</span>`;
  }
  document.getElementById('add').disabled = points.length >= MAX_POINTS;
}

document.getElementById('add').onclick = () => addPoint({ lat: 0, lng: 0 });
document.getElementById('random').onclick = () => { points.length = 0; points.push(randomPoint(), randomPoint()); update(); frameArc(); };
document.getElementById('clear').onclick = () => { points.length = 0; update(); };

update();
