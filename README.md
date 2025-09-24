# Abacws — API + 3D Visualiser

Abacws is a two-part system for exploring IoT devices in a building model:
- API: a Node.js/Express service backed by MongoDB for devices, data, history, and a simple query layer. Ships with Swagger UI.
- Visualiser: a React + three.js web app that renders your building GLB layers and lets you add, move, and pin devices directly in 3D.

Both services run locally with Docker Compose and can be deployed behind a reverse proxy (Traefik, nginx, etc.).

---

## Features at a glance

- Replaceable 3D building model (GLB/GLTF) via a simple manifest file
- Device CRUD via API or directly from the visualiser (double-click to add)
- Interactive device editing
  - Select device icon to open a floating HUD with actions: Lock/Unlock, ↕ Move (Y), ↔ Move (XZ)
  - Move devices with TransformControls; live PATCHs during move and final save on release
  - Auto-unlock before move and auto-lock after when using HUD actions
  - Pin/unpin from lock sprite, HUD, or keyboard (P)
- Better visibility & interaction
  - Device icon and lock are sprites that occlude behind geometry and scale with zoom
  - Larger invisible pick proxy to make selection easier
  - Hover and selection color cues; robust click targeting
- Smooth navigation
  - Mouse wheel zoom and RMB orbit always work (HUD doesn’t steal events)
  - Click-away deselection: click empty space or use the ✕ button or Escape to close the HUD
- API docs via Swagger UI
 - Coordinate alignment & debug tools (auto align, scale suggestion, bbox overlay, migration script)

---

## Repo layout

```
.
├─ docker-compose.yml            # Compose file for mongo, api, visualiser
├─ LICENSE                       # MIT License
├─ README.md                     # This doc
├─ api/                          # Express API
│  ├─ Dockerfile
│  ├─ openapi.yaml               # Swagger spec served by the API
│  ├─ package.json
│  └─ src/
│     ├─ app.js                  # Express app entry
│     ├─ generate.js             # Seed/generate helpers
│     └─ api/
│        ├─ routers/             # Devices & data routes
│        ├─ middleware/
│        ├─ data/
│        │  └─ devices.json      # Mirrored device data (for convenience)
│        └─ ...
└─ visualiser/                   # React + three.js app
   ├─ Dockerfile
   ├─ package.json
   ├─ public/
   │  ├─ index.html
   │  └─ assets/
   │     ├─ manifest.json        # Which GLB layers to load
   │     └─ *.glb                # Your building layers
   └─ src/
      ├─ three/Graphics.js       # Scene, devices, HUD, interactions
      ├─ components/
      ├─ hooks/
      └─ views/
```

---

## Quickstart (Docker)

Prerequisites: Docker Desktop (or engine) and a terminal (PowerShell on Windows).

1) Build and start all services

```pwsh
# from repo root
docker compose down -v
docker compose up -d --build
```

2) Open the apps
- Visualiser: http://localhost:8090/
- API health: http://localhost:5000/health → {"status":"ok"}
- API docs (Swagger UI): http://localhost:5000/api/

3) Troubleshooting
- Visualiser is blank:
  - Check DevTools → Console/Network for 404s from /assets/* or /api/*.
  - Ensure visualiser/public/assets/manifest.json exists and references valid GLB filenames in public/assets.
  - If the GLBs look ~130 bytes, you likely have Git LFS pointers. Pull the real files:
    ```
    git lfs install
    git lfs pull
    ```
- API unreachable:
  - Confirm container is healthy: `docker ps` and check abacws-api logs.
  - The API exposes port 5000; the visualiser proxies to it in dev and NGINX proxies in prod.

---

## Using the 3D visualiser

- Add a device: double-click on the floor to create a device at that spot; you’ll be prompted for name, type, and floor.
- Select a device: click its icon. A floating HUD shows the name and actions.
- Move a device: use the HUD buttons (↕ Move or ↔ Move) to constrain axes; the app will auto-unlock and re-lock if needed. Live position updates are PATCHed during move and a final save happens on release.
- Pin/unpin: click the lock sprite above the icon, use the HUD “Lock/Unlock” button, right-click the lock, or press P while hovering/selected.
- Deselect: click empty space, click the ✕ in the HUD, or press Escape.
- Camera: mouse wheel to zoom; right mouse button to orbit.

Occlusion & scaling: the device icon and lock are rendered as sprites that scale with distance and disappear behind geometry naturally.

### Coordinate Alignment & Debug Tools

Goal: Bring legacy device coordinate clouds into the same origin & scale as the building model without permanently corrupting raw data until you choose to migrate.

Flags / Runtime Controls:
```
VITE_FORCE_LEGACY_OFFSET=true      # Always apply legacy translation (160,0,-120)
VITE_COORDS_NORMALIZED=true        # Mark device coords already normalized; disables heuristic legacy check
VITE_AUTO_ALIGN_DEVICES=true       # Compute & apply center alignment delta (cached in localStorage)
```
Or set at runtime before the app loads (DevTools early):
```
window.__ABACWS_FORCE_LEGACY_OFFSET__ = true;
window.__ABACWS_COORDS_NORMALIZED__ = true;
window.__ABACWS_AUTO_ALIGN__ = true;
```

Settings Panel (⚙ top‑right) lets you:
 - Toggle Auto Align (reload applies)
 - View Suggested Uniform Scale (ratio of model planar span to device cloud span)
 - Show Bounding Boxes (teal = devices, orange = model floor) for visual inspection

Scale Suggestion: Only calculated; NOT auto-applied. Use migration script if you want to bake scale + translation.

Migration Script (with scale):
```
node visualiser/scripts/migrateDeviceCoords.js devices.json > devices-aligned.json \
  ALIGN_DELTA="dx,dy,dz" SCALE_FACTOR=1.234
```

If you previously relied on auto alignment, grab cached delta from:
```
localStorage.getItem('__abacws_device_alignment_v1')
```
Then apply with SCALE_FACTOR (if desired) and import updated JSON into backend storage.

Bounding Boxes: Helpers can be toggled on/off; they do not persist and are ignored in interaction picking.

Debug Logging:
```
localStorage.setItem('__abacws_debug','1'); location.reload();
```
You will see `[ALIGN]` and scale suggestion events in console.

---

## Swapping the building model (GLB)

- Put your GLB files in `visualiser/public/assets/`.
- Edit `visualiser/public/assets/manifest.json` to list layer filenames in load order, for example:

```
{
  "layers": [
    "floors.glb",
    "exterior-walls.glb",
    "windows.glb",
    "stairs.glb",
    "glass.glb"
  ]
}
```

Tip: If your repo uses Git LFS for assets and you see tiny text files instead of real models, run:

```
git lfs install
git lfs pull
```

---

## API overview

- Base URL (local): http://localhost:5000/api
- Swagger UI: http://localhost:5000/api/

Key endpoints (see full `api/openapi.yaml`):
- GET /devices — list all devices
- POST /devices — create a device
- GET /devices/{deviceName} — get one device
- PATCH /devices/{deviceName} — update type, floor, position, pinned
- GET /devices/{deviceName}/data — latest data for a device
- PUT /devices/{deviceName}/data — add data (optionally with units)
- GET /devices/{deviceName}/history — historical data
- DELETE /devices/{deviceName}/history — clear historical data
- GET /query — filter devices
- GET /query/data — filter devices and last data
- GET /query/history — filter devices and their history

Persistence engines:
- Default: MongoDB (container `abacws-mongo`). Historical data per device is stored in per-device collections.
- Optional: PostgreSQL (container `abacws-postgres`). Enable by setting `DB_ENGINE=postgres` (env or compose). Tables:
  - `devices(name PRIMARY KEY, type, floor, pos_x, pos_y, pos_z, pinned, created_at, updated_at)`
  - `device_data(id bigserial PK, device_name FK→devices, timestamp bigint, payload jsonb)`
  - Index on `(device_name, timestamp DESC)` for fast latest + history queries.
- Offline / Disabled: `DB_ENGINE=disabled` will serve devices from `devices.json` and keep transient in‑memory history only (no persistence).

Runtime switching:
```
DB_ENGINE=postgres docker compose up -d --build
```
Or edit the `api` service environment in `docker-compose.yml`.

Data parity:
- Both engines expose identical JSON shapes to the visualiser/API clients.
- `devices.json` remains a convenience mirror and is updated on creates/updates in either mode.

Migration from Mongo to Postgres:
1. Start Mongo mode and ensure devices exist.
2. Start Postgres mode (DB_ENGINE=postgres). If you need to seed, write a one-off script to read `devices.json` and insert rows (future helper can be added).
3. Historical data is not auto-migrated (per-collection → single table). A migration script would iterate device collections and bulk insert into `device_data`.

Notes:
- Unique device name enforcement: Mongo index vs Postgres primary key constraint (offline checks duplicate in memory).
- Latest data lookup: Mongo sort/findOne vs Postgres ORDER BY LIMIT 1 vs offline last array entry.
- History limits: capped at 10k records per request (configurable in code).
- Disabled mode returns HTTP 503 for write/data endpoints (create device, add data, update, history write) while still allowing GET /devices.

### External Postgres Time‑Series (Experimental)

You can map existing tables in the same Postgres cluster (e.g. a large time‑series fact table) to Abacws devices without ingesting or duplicating data.

Concepts:
- Data Source: connection + schema metadata (currently reuses main DB connection; future: separate host/credentials).
- Device Mapping: links a device name to a (table, device_id_column, device_identifier_value, timestamp_column, value_columns[]). Optionally pick a primary_value_column for sphere color scaling.

Endpoints (all under `/api` and documented in `openapi.yaml`):
- `GET /datasources` / `POST /datasources` / `PATCH /datasources/{id}` / `DELETE /datasources/{id}`
- `GET /datasources/{id}/tables` — list tables in schema
- `GET /datasources/{id}/columns?table=...` — list columns
- `GET /mappings` / `POST /mappings` / `PATCH /mappings/{id}` / `DELETE /mappings/{id}`
- `GET /mappings/device/{deviceName}/timeseries?from=..&to=..&limit=..`
- `GET /latest` — batch latest primary + value columns for all mapped devices (drives sphere coloration)

Example mapping payload (POST /mappings):
```json
{
  "device_name": "sensor_west_01",
  "data_source_id": 1,
  "table_name": "env_readings",
  "device_id_column": "sensor_id",
  "device_identifier_value": "west-01",
  "timestamp_column": "recorded_at",
  "value_columns": ["temperature_c", "humidity_pct"],
  "primary_value_column": "temperature_c"
}
```

UI Usage:
- Select a device → Data panel → External Time‑Series → Create/Edit Mapping.
- API key (x-api-key) for writes is read from `localStorage.abacws_api_key` (set manually via DevTools or future settings UI).
- After saving, page reload ensures hooks refetch; future enhancement: event-driven refresh.

Color Scaling:
- The `primary_value_column` is normalized across current latest values → gradient Blue (low) → Emerald (mid) → Red (high).
- Hover/Selection colors override the gradient temporarily.

Performance Notes:
- `/latest` groups mappings by (table, cols signature) to reduce queries.
- Per-device timeseries queries use indexed timestamp + device id predicates; ensure your source table has an index: `(sensor_id, recorded_at DESC)`.

Security & Credentials:
- Data source password is write-only (never returned).
- Avoid embedding production credentials in compose files; use environment variables / secrets.
- Future: separate pool per data source; currently assumes same DB for simplicity.

Limitations / Roadmap:
- Only single Postgres engine currently; no cross-database host connections yet.
- No aggregation (avg, min/max) or resampling—client fetches raw rows up to a limit (default 2000).
- No transformation expressions; consider adding computed columns or views server-side.
- Manual reload after save; planned improvement: in-memory cache invalidation and hook refresh.

---

### Health endpoints

Top-level (implemented in `app.js`):
- `GET /health` → `{ status: 'ok', db: { engine, status, error? } }`
- `GET /health/db` → direct DB/engine status only

Legacy (router-level):
- `GET /api/health` → basic process status (points you to the top-level endpoint for DB detail)

### Admin DB toggle endpoints

Guarded by `x-api-key` header (value from `API_KEY` env, default placeholder):
- `POST /api/admin/db/disable` → Force a 503 on state-changing datastore operations (simulated offline)
- `POST /api/admin/db/enable` → Re-enable datastore operations
- `GET /api/admin/db/status` → `{ engine, forcedDisabled }`

UI: The visualiser shows a small status panel (top-left) with API status, DB engine, DB status, and a toggle button (needs API key to modify).

---

## Local development

Without Docker (optional):
- API: `cd api && npm install && npm run dev` (listens on 5000)
- Visualiser: `cd visualiser && npm install && npm start` (dev server with proxy to :5000)

With Docker:
- Compose handles builds and runs. Edit code and rebuild with `docker compose up -d --build`.

---

## Deployment notes

- Reverse proxy (Traefik labels included in docker-compose.yml by default). Nginx/Apache are fine too.
- Visualiser container serves the production build (NGINX) on port 80; compose maps it to 8090 locally.
- Health checks:
  - API: GET /health → { status: "ok" }
  - Visualiser: GET /health (NGINX static 200)

---

## Contributing

PRs and issues welcome. Please run builds locally and sanity-check Docker compose before submitting.

---

## License

This project is licensed under the MIT License. See `LICENSE` for details.

Copyright (c) 2022–2025, the Abacws authors. All rights reserved.
