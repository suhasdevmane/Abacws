# Abacws Data Visualiser
Web application made to visualise IoT data for devices in the Abacws building at Cardiff University.\
This repository contains the API and the Visualiser tool, both of which are deployed using [docker](https://www.docker.com/).

Production deployments for these tools can be found at the following locations:
- [API](https://abacws.ggrainger.uk/api/)
- [Visualiser](https://abacws.ggrainger.uk/)



## Docs
You can view the documentation for the two separate services in their respective README files.
- [API](./api/README.md)
- [Visualiser](./visualiser/README.md)

## Quickstart (local Docker)

Prereqs: Docker Desktop enabled; PowerShell on Windows.

1. Clean and rebuild containers
  - This resets Mongo and rebuilds both images.
   
  ```pwsh
  docker compose down -v
  docker compose up -d --build
  ```

2. Verify endpoints
  - API health: http://localhost:5000/health → {"status":"ok"}
  - API docs (Swagger UI): http://localhost:5000/api/
  - Visualiser: http://localhost:8090/

3. Swap building models (.glb)
  - Put new .glb files in `visualiser/public/assets/`
  - Order and selection are controlled by `visualiser/public/assets/manifest.json`:
    - Example: `{ "layers": ["floors.glb", "exterior-walls.glb", ...] }`
  - The visualiser loads these in order on page load.

4. Common issues
  - Blank visualiser page: open dev tools → Console/Network for 404s from `/assets/*` or `/api/*`.
    - Ensure `manifest.json` names match files in `public/assets/`.
    - Ensure `/api` endpoints respond (see API docs URL above).
  - MongoDB corruption on Windows bind mounts: we use a named volume `mongo-data` by default for stability.

  ## Add devices from the 3D visualiser
  - Double-click on the building floor in the visualiser to add a device at that location.
  - You’ll be prompted for name, type, and floor. On save, it is persisted to the API and appears immediately in the scene and device list.
  - API docs include POST /devices (Swagger at http://localhost:5000/api/).

  ## Move and pin devices
  - Drag to move: Left-click and drag a device cube to reposition it on the floor. On release, the new position is saved to the API.
  - Pin/unpin: Right-click a device (or press the "P" key when hovering/selected) to toggle its pinned state. Pinned devices can’t be dragged. Pinned devices have a subtle emissive glow.
  - Persistence: All updates are saved to MongoDB and mirrored into `api/src/api/data/devices.json` inside the API container for convenience.

## Docker compose
I recommend using docker compose to deploy this to your own server alongside [traefik](https://traefik.io/traefik/).\
An example compose file can be seen below.

```yml
version: '3.8'
services:
  mongo:
    image: mongo
    container_name: abacws-mongo
    restart: always
    volumes:
      - ./mongo:/data/db

  api:
    image: ghcr.io/randomman552/abacws-data-vis:api-latest
    container_name: abacws-api
    restart: always
    depends_on:
      - mongo

  visualiser:
    image: ghcr.io/randomman552/abacws-data-vis:visualiser-latest
    container_name: abacws-visualiser
    restart: always
    depends_on:
      - api
    # Traefik is recommended, you can set up a NGINX or Apache proxy instead, but traefik is much easier.
    labels:
      - "traefik.enable=true"
      - "traefik.http.services.abacws-visualiser.loadbalancer.server.port=80"
      - "traefik.http.routers.abacws-visualiser.rule=Host(`visualiser.abacws.example.com`)"
      - "traefik.http.routers.abacws-visualiser.entrypoints=https"
      - "traefik.http.routers.abacws-visualiser.tls=true"
```

## Supported tags
| Tag                 | Description                 |
|:-------------------:|:---------------------------:|
| `visualiser-latest` | Production ready visualiser |
| `visualiser-main`   | Development visualiser      |
| `visualiser-vx.y.z`  | Specific visualiser version |
| `api-latest`        | Production ready API        |
| `api-main`          | Development API             |
| `api-vx.y.z`         | Specific API version        |
