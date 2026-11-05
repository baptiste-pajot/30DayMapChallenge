// Day 1 · Points: spherical centroid of clicked points. Depends on utils/*.js and centroid.js.
const RED = '#ff4d6d', YELLOW = '#ffc400';
const points = [];

let data = { points: featureCollection([]), centroid: featureCollection([]), ties: featureCollection([]), lines: featureCollection([]) };

const map = createMap('map', {
  center: [2.35, 30],
  zoom: 1.6,
  onStyleLoad: map => {
    addSources(map, data);
    map.addLayer({
      id: 'lines', type: 'line', source: 'lines',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 2.5, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, RED, 1, YELLOW] },
    });
    // Discrete ties are drawn as hollow yellow rings wider than a point marker (6 px + 1.5 px stroke), so a
    // tie sitting exactly on a point (e.g. tetrahedron) stays visible around it; dense ties are small dots.
    map.addLayer({
      id: 'ties', type: 'circle', source: 'ties',
      paint: {
        'circle-radius': ['get', 'radius'],
        'circle-color': YELLOW,
        'circle-opacity': ['case', ['get', 'ring'], 0, 1],
        'circle-stroke-width': ['case', ['get', 'ring'], 3, 1],
        'circle-stroke-color': ['case', ['get', 'ring'], YELLOW, '#000'],
      },
    });
    map.addLayer({
      id: 'centroid-pulse', type: 'circle', source: 'centroid',
      paint: { 'circle-radius': 10, 'circle-color': YELLOW, 'circle-opacity': 0.4 },
    });
    map.addLayer({
      id: 'centroid', type: 'circle', source: 'centroid',
      paint: { 'circle-radius': 8, 'circle-color': YELLOW, 'circle-stroke-width': 2, 'circle-stroke-color': '#000' },
    });
    addPointLayers(map, 'points', { color: RED, text: ['to-string', ['get', 'n']] });
  },
});

// Pulsing halo around the centroid.
(function pulse(t) {
  const k = (t % 1500) / 1500;
  if (map.getLayer('centroid-pulse')) {
    map.setPaintProperty('centroid-pulse', 'circle-radius', 8 + 22 * k);
    map.setPaintProperty('centroid-pulse', 'circle-opacity', 0.5 * (1 - k));
  }
  requestAnimationFrame(pulse);
})(0);

onMapClick(map, 'points', {
  onAdd: p => { points.push(p); update(); framePoints(); },
  onRemove: i => { points.splice(i, 1); update(); },
});
addHoverPopup(map, ['points', 'centroid', 'ties']);

// ---------- Camera ----------

// Centre the globe on the centroid, zoomed so every point and line is visible. With no unique centre
// (points balance out) there's nothing meaningful to centre on, so the camera stays put.
function framePoints() {
  const c = sphericalCentroid(points);
  if (!c || points.length < 2) return;
  frameGlobe(map, {
    center: c,
    coords: [...points.map(p => [p.lng, p.lat]), ...data.lines.features.flatMap(f => f.geometry.coordinates)],
    extent: 2 * Math.max(...points.map(p => angle(c, p))),
  });
}
const framePointsSoon = debounce(framePoints, 600);  // reframe once typing pauses, not on every keystroke

// ---------- Rendering ----------

// Full refresh: map + table. Use after adding/removing points.
function update() {
  renderScene();
  renderCoordTable(document.getElementById('rows'), points, {
    onEdit: () => { renderScene(); framePointsSoon(); },
    onRemove: i => { points.splice(i, 1); update(); },
  });
}

function renderScene() {
  const c = sphericalCentroid(points);
  const ties = !c && points.length ? tiedCentres(points) : [];

  data = {
    points: featureCollection(points.map((p, i) =>
      pointFeature(p, { i, n: i + 1, label: `#${i + 1} · ${fmt(p)}<br><i>click to remove</i>` }))),
    centroid: featureCollection(c ? [pointFeature(c, { label: `Centroid · ${fmt(c)}` })] : []),
    ties: featureCollection(ties.map(t => pointFeature(t, {
      ...(ties.length > 12 ? { radius: 2.5, ring: false } : { radius: 11, ring: true }),
      label: `Tied centre · ${fmt(t)}`,
    }))),
    lines: featureCollection(c && points.length > 1 ? points.map(p => lineFeature(greatCircle(p, c))) : []),
  };
  setSources([map], data);

  const box = document.getElementById('centroid');
  if (!points.length) box.textContent = 'Add points to compute the centroid.';
  else if (!c) box.innerHTML = `<b>No unique centre</b> — the points balance out, so their mean direction vanishes.<br>
    <span class="sub">${ties.length > 12
      ? 'Every point on the yellow line is an equally valid centre'
      : `${ties.length} equally valid centres (yellow)`}: they minimise the sum of squared great-circle distances.</span>`;
  else box.innerHTML = `<b>Centroid</b> ${fmt(c)}<br>
    <span class="sub">${points.length} point${points.length > 1 ? 's' : ''} · concentration ${(c.strength * 100).toFixed(1)}%</span>`;
}

document.getElementById('undo').onclick = () => { points.pop(); update(); };
document.getElementById('clear').onclick = () => { points.length = 0; update(); };
document.getElementById('random').onclick = () => {
  for (let i = 0; i < 5; i++) points.push(randomPoint());
  update();
  framePoints();
};

update();
