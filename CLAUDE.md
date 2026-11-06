# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Entries for the #30DayMapChallenge (November 2026). One folder per day, `NN_theme` (e.g. `01_points`, `02_lines`, … `30_pen_and_paper`); days not yet started only contain a `.gitkeep` (delete it once the folder gets real content).

## Running

No build, package manager, linter or tests. Each day is a static page: open `NN_theme/index.html` directly in a browser (`xdg-open`) or serve the **repo root** (`python -m http.server`) — pages load `../utils/`, so serving a day folder alone breaks them. Scripts are classic `<script>` tags, not ES modules, precisely so `file://` works — keep it that way.

Quick checks without a browser:
- Syntax: `node -e "new Function(require('fs').readFileSync('app.js','utf8'))"`
- Geometry: concatenate `utils/geo.js` (plus the day's maths file) with a test snippet into `$TMPDIR` and run it with `node` — no DOM or Mapbox dependency.

## Shared code (`utils/`)

- `config.js` — `window.MAPBOX_TOKEN = 'pk.…'`, one token for every day. Gitignored (root `.gitignore` matches `config.js` anywhere); `config.example.js` is the committed template. `map.js` shows a warning overlay and stops if it's missing.
- `geo.js` — spherical math shared by all days (unit vectors, central angles, `greatCircle`, `randomPoint`).
- `map.js` — Mapbox + panel helpers: `createMap` (style, nav control, globe fog, `onStyleLoad` hook), `addSources`/`setSources`, `addPointLayers`, `onMapClick` (add vs remove by hit-test), `addHoverPopup` (shows each feature's `label` property), `renderCoordTable`, and `frameGlobe` (auto-zoom: centre on a meaningful point — centroid, arc midpoint — rather than the bbox centre, zoom from `globeZoom(extent, fitZoom)`; days call it after add/random/drag-end and, debounced, after table edits, never during a drag).
- `panel.css` — side panel, buttons, coordinate table; `.info` boxes take their colour from a `--accent` CSS variable.

A day's `index.html` loads, in order: Mapbox GL JS (CDN), `../utils/config.js`, `../utils/geo.js`, `../utils/map.js`, any day-specific maths file (e.g. `centroid.js`), then `app.js`. Classic scripts share one global scope, so a day file must not redeclare a top-level name from utils (`DEG`, `fmt`, `LIMITS`, …) — a duplicate `const` is a SyntaxError that silently kills the whole script.

Day 3 (`03_polygons`) is the exception: no Mapbox GL, so it loads only `config.js`, `geo.js`, `polyhedra.js`, `app.js`. It draws with raw WebGL2 and stitches a Web Mercator texture from the Mapbox Static Tiles API (CORS images, so `file://` still works); the fragment shader does the gnomonic face → lat/lng → Mercator lookup per pixel. `polyhedra.js` is DOM-free and testable with `node` like the other maths files.

Day 4 (`04_clusters`) is a flat map of mainland France (Lambert conformal conic, Lambert‑93 parallels), not the globe. Its OSM data is a committed snapshot in `04_clusters/data/<category>.js` (classic scripts setting `POIS.<category>`, injected on demand since `fetch` of local files fails on `file://`), refreshed with `node 04_clusters/fetch_data.js [category…]` (Overpass, CSV output, falls back across public endpoints; 1–3 min per category). The page queries Overpass live only on "Reload from OSM" or a missing snapshot. Points are clustered by Mapbox's own `cluster: true` GeoJSON source.

## Patterns in each day's `app.js`

- **State → render**: a `points` array is the single source of truth. `update()` = `renderScene()` (rebuild the `data` FeatureCollections, `setSources`) + `renderCoordTable(...)`. The table's `onEdit` calls only `renderScene()` so inputs keep focus while typing.
- **Layers are added in the `onStyleLoad` callback** from the module-level `data` object, so they exist even when `update()` ran before the style finished loading.
- **Great-circle lines** use unwrapped longitudes (may exceed ±180) so Mapbox doesn't draw them the long way across the antimeridian; clicked/dragged positions are stored wrapped via `lngLat.wrap()`.
- Point features carry `i` (index into `points`, used by click-to-remove/drag) and `label` (hover HTML).
