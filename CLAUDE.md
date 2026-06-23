# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Backend Node.js/Express API for CENCA (Conservatoire d'Espaces Naturels Champagne-Ardenne) — a GIS web application for managing natural sites. It serves as the data provider for an Angular frontend.

## Commands

```bash
# Install dependencies
npm install

# Start the server (development)
npm start
# equivalent: node node_base_sites.js

# Docker (development)
docker-compose up

# Docker (production — HTTPS + SSL certs)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

There is no test runner configured. Manual testing is done via `test_backend.sh`.

## Environment Variables (`.env`)

| Variable | Purpose |
|---|---|
| `NODE_PORT` | Server port (8887 dev, 8889 prod) |
| `NODE_ENV` | `development` or `production` (controls HTTPS) |
| `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT` | PostgreSQL connection |
| `SECRET_KEY` | JWT signing secret |
| `SALT_ROUNDS` | bcrypt rounds |
| `FILES_DIR_ENV` | Path for static file serving (default: `./files`) |
| `LIZMAP_USER`, `LIZMAP_PASSWORD` | External Lizmap WFS authentication |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Monitoring alerts |

## Architecture

### Entry Point

`node_base_sites.js` — bootstraps Express, applies middleware (CORS allowlist, rate limit, Prometheus metrics), and mounts all routers. HTTP in dev, HTTPS (Let's Encrypt) in production.

### Route Map

| Mount | File | Purpose |
|---|---|---|
| `/auth` | `routes/admin/userRoutes.js` | Register, login, logout, JWT management |
| `/admin` | `routes/admin/adminRoute.js` | Admin-only operations |
| `/sites` | `routes/sites/getSitesRoutes.js` | GET site data |
| `/sites` | `routes/sites/putSitesRoutes.js` | PUT/update site data |
| `/sites` | `routes/sites/deleteSitesRoutes.js` | DELETE site data |
| `/sites` | `routes/sites/foncierRoutes.js` | Land registry (foncier) endpoints |
| `/api-geo` | `routes/apiGeoRoutes.js` | Unified geo API (communes, cadastre, Lizmap) |
| `/process` | `routes/processRoutes.js` | File upload → Python pipeline trigger |
| `/picts` | `routes/pictureRoute.js` | Image upload/resize/serve |
| `/docs` | `routes/docsRoutes.js` | Markdown docs served as HTML |
| `/files` | static | Static file serving from `FILES_DIR_ENV` |
| `/metrics` | express-prom-bundle | Prometheus metrics |

### Shared Modules (`fonctions/`)

- **`fonctionsSites.js`** — Core DB utilities. All route files depend on this:
  - `ExecuteQuerySite(pool, {query, message}, type, callback)` — callback-based query executor for SELECT/INSERT/UPDATE/DELETE
  - `ExecuteQuerySitePromise(pool, param, type)` — Promise wrapper for the above
  - `convertToWKT(coordinates, typeGeometry?)` — GeoJSON → EWKT (SRID=2154, Lambert 93)
  - `extractZipFile(filePath, extractPath)` — unzip shapefile archives
  - `executeQueryAndRespond(pool, SelectFields, FromTable, where, uuid, res, message)` — convenience: run query and send JSON response
- **`fonctionsAuth.js`** — `authenticateToken` middleware: validates Bearer JWT and checks against DB blacklist (`admin.blacklist_token`)
- **`fonctionsMails.js`** — Nodemailer wrappers
- **`geo_api.js`**, **`geo_api_bttf.js`** — HTTP clients for external GIS services (geo.api.gouv.fr, IGN WFS, Lizmap WFS)
- **`querys.js`** — SQL query string builders (e.g., `generateDeleteQuery`)
- **`routeHandlers.js`** — Reusable route logic (e.g., `handleDelete` with transaction support)

### Database (`dbPool/poolConnect.js`)

Exports a singleton `Pool` (max 20 connections) with keep-alive pings every 5 minutes and auto-reconnect on error. All route files import `pool` from this module.

### External GEO Services

The `/api-geo` routes aggregate three external sources:
- **geo.api.gouv.fr** — French communes by department
- **IGN WFS** (`data.geopf.fr`) — Cadastral parcels (bbox or commune)
- **Lizmap WFS** (authenticated) — CENCA-specific GIS layers

### Foncier Pipeline

`routes/processRoutes.js` handles file uploads (via multer) and spawns a Python process (`extraction_fonciere/extraction_foncier.py`) in a virtualenv at `extraction_fonciere/env_foncier/`. Uploaded files land in `extraction_fonciere/extractions/A_TRAITER/`.

### Monitoring

A separate Docker service (`surveillance/`) runs a Node.js monitoring agent that polls API routes and sends Telegram alerts on failure.

## Key Conventions

- **Authentication**: Apply `authenticateToken` from `fonctionsSites.js` to protect routes. It attaches decoded JWT payload to `req.tokenInfos`.
- **DB queries**: Use `ExecuteQuerySite` for callback style or `ExecuteQuerySitePromise` for async/await. Always pass a descriptive `message` field for logging.
- **Geometry**: All spatial data is stored in SRID=2154 (Lambert 93). Use `convertToWKT()` to convert GeoJSON coordinates to EWKT before inserting.
- **CORS**: Origins are allowlisted in `node_base_sites.js`. Add new allowed origins there.
- **Rate limiting**: Applied globally (200 req / 5 min) but skipped for localhost requests.
