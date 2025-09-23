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

Persistence:
- Data is stored in MongoDB (container `abacws-mongo`).
- For convenience, devices are mirrored to `api/src/api/data/devices.json` inside the API container.

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
