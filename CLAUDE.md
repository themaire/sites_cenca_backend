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

# Development (outside Docker): npm install + npm start, port 8887
./start.sh dev

# Production redeploy (MCP tests, image build BEFORE stopping prod, down/up, health checks): see documentation/deploiement_start_sh.md
./start.sh prod -b -d -r

# Docker (production — HTTPS + SSL certs): docker-compose.yml is the complete prod config
docker-compose up -d
# equivalent, kept for start.sh prod: docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

There is deliberately no `docker-compose.override.yml`: docker-compose loads it automatically, which once made a plain `up` start production in HTTP (dev mode). Do not recreate one. `docker-compose` 1.29.2 on this server crashes when recreating `node_app` (`KeyError: 'ContainerConfig'`); workaround: `docker-compose rm -sf node_app` then `up -d`.

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
| `RATE_LIMIT_IP_BLANCHES` | Public IPs exempt from rate limits, comma-separated (default `81.80.207.65`); LAN IPs are always exempt |
| `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_NUM_CTX`, `OLLAMA_THINK`, `OLLAMA_TIMEOUT_MS` | Chatbot LLM: LAN Ollama servers in preference order (comma-separated, optional per-server model and GPU layers as `url|model|num_gpu`, e.g. the dev laptop `|gemma4:12b|15`), default model tag, context size, thinking on/off (default off), max time per question, queue + prompt reading + generation (default 15 min, then aborted and the Ollama server freed; undici agent, Node fetch would abort at 300 s) |
| `CHAT_QUESTIONS_MAX` | Chatbot: questions per conversation (default 10), then `413` → front opens a new conversation |
| `CHAT_SIMULTANES_MAX` | Chatbot: questions at once per Ollama server (default 1); when every server is full, `POST /chat` answers `503 sonneur_occupe` and `GET /chat/etat` reports `occupe: true` (in-process counter: per backend process) |
| `MCP_URL`, `MCP_API_TOKEN` | Chatbot access to the `mcp/` server (same token as `mcp/.env`) |

## Architecture

### Entry Point

`node_base_sites.js` — bootstraps Express, applies middleware (CORS allowlist, rate limit, Prometheus metrics), and mounts all routers. HTTP in dev, HTTPS (Let's Encrypt) in production.

### Route Map

| Mount | File | Purpose |
|---|---|---|
| `/auth` | `routes/admin/userRoutes.js` | Register, login, logout, JWT management |
| `/admin` | `routes/admin/adminRoute.js` | Admin-only operations |
| `/sites` | `routes/sites/getSitesRoutes.js` | GET sites: search, site sheet, communes, milieux, conservateurs |
| `/sites` | `routes/sites/getPgestionRoutes.js` | GET management plans (docplan) |
| `/sites` | `routes/sites/getMfuRoutes.js` | GET land control: MFU acts, parcels, MFU projects (pmfu) |
| `/sites` | `routes/sites/getTravauxRoutes.js` | GET works projects (`opegerer`, TRV): projects, operations, objectives, Word sheet |
| `/sites` | `routes/sites/getListesRoutes.js` | GET form choice lists (`/selectvalues`) |
| `/sites` | `routes/sites/getDocsLiesRoutes.js` | GET documents linked to items (`files.docs`) |
| `/sites/autres` | `routes/projetsAutres/{get,put,delete}ProjetsAutresRoutes.js` | Non-works projects (SEN, ETU, POL, FON, PAR, ACC, ADM, AUT) in the PostgreSQL schema `opeautres` (until now filled through a legacy MS Access front end plugged on the same DB; one generic model for every type, no type-specific columns): search, project + operations with their places, targets, indicators, contributors. GET public, writes JWT. Shared SQL and checks in `fonctions/projetsAutres.js`; front contract in `documentation/instructions_front_projets_autres.md`. Mounted before the `/sites` routers |
| `/sites` | `routes/sites/putSitesRoutes.js` | PUT/update site data |
| `/sites` | `routes/sites/deleteSitesRoutes.js` | DELETE site data |
| `/sites` | `routes/sites/foncierRoutes.js` | Land registry (foncier) endpoints |
| `/api-geo` | `routes/apiGeoRoutes.js` | Unified geo API (communes, cadastre, Lizmap) |
| `/process` | `routes/processRoutes.js` | File upload → Python pipeline trigger |
| `/picts` | `routes/pictureRoute.js` | Image upload/resize/serve |
| `/docs` | `routes/docsRoutes.js` | Markdown docs served as HTML |
| `/menu` | `routes/menuRoutes.js` | Header menu (`gestint.m_menu_header`): `/menu/arbre` (public) and `/menu/arbre/admin` (JWT, adds « Paramètres ») return the whole tree (`enfants[]`) in one query, cached 10 min in memory + ETag; legacy per-level `/parent=:id` routes kept until the front switches (`documentation/instructions_front_menu.md`) |
| `/chat` | `routes/chatRoutes.js` | Chatbot (JWT): local LLM via Ollama + whitelisted MCP business tools, SSE stream |
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

### MCP server (`mcp/`)

Read-only MCP server giving Claude SQL access to the database. Self-contained sub-project: own `package.json`, `.env`, pool, `Dockerfile`. Runs as service `mcp_sites` in the root `docker-compose.yml` with `network_mode: host` (deliberately on no compose network, isolated from `node_app`/`surveillance`); listens on `MCP_HOST:MCP_PORT` (8891). Never import it from `node_base_sites.js` nor reuse the backend pool. Offline tests: `cd mcp && npm test`. Business knowledge for Claude lives in `mcp/documentation/base_sites_cenca.md`. See `mcp/README.md`. A second, optional pool (`mcp/dbPoolWebobs.js`, `WEBOBS_DB_*`) reaches the WebObs naturalist observations database (`natobs`, another PostgreSQL server) through predefined `webobs_*` tools only (`fonctions/requetesWebobs.js`); site geometries are read from the sites DB and sent to natobs as EWKB. `export_obs.webobs` columns are shifted by one from column `i` onwards (see the header of `requetesWebobs.js`). Habitat tools (`habitats_site`, `habitats_cartographie`, schema `hab`) live in `fonctions/requetesHabitats.js`; `perimetres_modifies`, `mesures_compensatoires`, `objectifs_projets` in `requetesMetier.js`. They come from the still-valid queries of `ressources/bdd/exemples_sql.json` (ignored file, not versioned; 31 of its 81 queries target dropped views or are auth/write queries: do not reuse them).

## Key Conventions

- **Authentication**: Apply `authenticateToken` from `fonctionsSites.js` to protect routes. It attaches decoded JWT payload to `req.tokenInfos`.
- **DB queries**: Use `ExecuteQuerySite` for callback style or `ExecuteQuerySitePromise` for async/await. Always pass a descriptive `message` field for logging.
- **Geometry**: All spatial data is stored in SRID=2154 (Lambert 93). Use `convertToWKT()` to convert GeoJSON coordinates to EWKT before inserting.
- **CORS**: Origins are allowlisted in `node_base_sites.js`. Add new allowed origins there.
- **Rate limiting**: Applied globally per 5 min: 2000 req per user when the request carries a valid JWT (signature checked, no DB lookup), otherwise 200 req per IP. `/auth/login` allows 10 failures / 15 min per IP; register, forgot/reset-password 5 / 15 min. Exempt: loopback, LAN and Docker ranges (`estIpInterne`, from `req.ip`, never `Host` or `X-Forwarded-For`), `RATE_LIMIT_IP_BLANCHES`, and `/menu`.
- **Metrics**: `/metrics` answers only LAN/Docker IPs (Prometheus scrapes `node_app:8887`). Every label value is a series kept in memory: 404 paths are collapsed to `#inconnu`, `/files/*` to `/files/#fichier`, Internet client IPs to `externe`. Chatbot usage: counter `sonneur_questions_total{issue}` (`reponse`, `aide`, `occupe`, `erreur`, `interrompue`), declared in `routes/chatRoutes.js` on the same prom-client registry; never add a per-user label.

### Chatbot (`/chat`)

`routes/chatRoutes.js` runs a tool-calling loop on a local LLM (Ollama, Gemma 4) and streams the answer as SSE events (`attente`, `outil`, `texte`, `fin`, `erreur`). Data comes only from the `mcp/` server, reached as an MCP **client** over HTTP (`fonctions/clientMcp.js`); the MCP is never mounted in `node_base_sites.js`. `OUTILS_AUTORISES` in `clientMcp.js` whitelists the predefined business tools: `executer_requete` (free SQL) and schema-introspection tools are deliberately excluded. The system prompt carries `GUIDE_METIER` (short business vocabulary; the MCP's `documentation_base` is SQL-oriented and deliberately not injected, it costs ~3 000 tokens on CPU) and `CAPACITES` (the user-facing list of what the chatbot can do, answered to « que sais-tu faire ? »): keep it in sync with `OUTILS_AUTORISES` and the MCP tool parameters. Site names in answers are Markdown links `/site/<code>` (`/site/<uuid>` for a site without code): the model writes the code, `reecritureLiens` keeps only codes found in this question's tool results (or in earlier answers) and turns the others into plain names. Each question goes to the reachable Ollama server with the fewest chats in progress (in-process counter, ties broken by `OLLAMA_URL` order) and stays there for all its tool rounds. The conversation history is held by the front end (stateless backend). In Docker, `node_app` sits on the `monitoring` bridge, pinned to `172.22.0.0/16` in `docker-compose.yml`: that subnet must stay in `ALLOWED_IPS` of `mcp/.env`, and `MCP_URL` uses the host LAN address (`MCP_HOST`). Aborting a question (front `AbortController.abort()`, panel closed, or `OLLAMA_TIMEOUT_MS`) closes the request to Ollama even during prompt reading (the backend passes its own signal to `fetch`, since ollama-js cannot cancel before response headers) and frees the server; verified on the CPU server. Backend walkthrough (flow, abort chain, busy state, guards against model errors): `documentation/chatbot/fonctionnement_backend.md`. Front-end instructions: `documentation/chatbot/instructions_front_claude_code.md`.
