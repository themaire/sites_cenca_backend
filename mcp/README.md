# Serveur MCP « cenca-sites »

Serveur [MCP](https://modelcontextprotocol.io) Node.js/Express qui donne à Claude un accès **en lecture seule** à la base PostgreSQL/PostGIS des sites du CENCA (sites, espaces, maîtrise foncière, documents de gestion, travaux, annuaire), pour l'interroger en langage naturel.

Il vit dans le dépôt du backend mais tourne dans **son propre processus et son propre container**, avec son propre `.env` et son propre pool de connexions (4 au maximum). Il n'est pas monté dans `node_base_sites.js` et n'est jamais exposé sur Internet : il écoute sur `127.0.0.1` par défaut.

## Ce que Claude peut faire

**Documentation métier** : `documentation_base` renvoie [`documentation/base_sites_cenca.md`](documentation/base_sites_cenca.md) (schémas, jointures non déclarées, conventions `validite` / `actuel`, SRID, pièges). **C'est ce fichier qu'il faut enrichir** quand Claude se trompe sur le sens d'une donnée.

**Outils métier**, repris des requêtes des routes du backend :

| Outil | Rôle | Origine |
|---|---|---|
| `rechercher_sites` | Recherche par texte (sans accents), type, commune, milieu, responsable | `/sites/criteria/...` (`listesitescenca`) |
| `fiche_site` | Site + espace, surfaces déclarée et calculée, centroïde, communes, conservateurs, documents de gestion, actes, projets | `/sites/uuid=`, `/commune`, `/conservateur`, `/pgestion` |
| `geometrie_site` | Contour en GeoJSON WGS84 simplifié | `/sites/uuid=` |
| `sites_autour_point` | Sites à moins de N m d'un point GPS | — |
| `sites_par_commune` | Sites d'une commune (nom ou INSEE) | `/sites/commune` |
| `synthese_sites` | Nombre et surfaces par type de site (et par département) | — |
| `foncier_site` | Actes MFU (multi-sites compris) et parcelles par type de propriétaire | `/sites/mfu/...`, `/parcelles_mfu` |
| `echeances_actes` | Actes arrivant à échéance ou échus récemment | — |
| `rechercher_projets` | Projets de gestion par année ou période, site, responsable, statut, type | `/sites/criteria_travaux/...` |
| `travaux_site` | Tous les projets d'un site (code, uuid ou nom) et leurs opérations sur une période, avec totaux par année et par action | — |
| `operations_projet` | Opérations d'un projet : actions, quantités, maître d'œuvre, financeurs | `/sites/operations/uuid=/lite` |
| `bilan_operations` | Agrégat des opérations par action et par année | — |
| `indicateurs_sites` | Chiffres clés et synthèses des sites gérés (départements, Natura 2000/APB…, milieux, types d'actes, propriétaires, agences de l'eau, réserves, protection forte, nouveaux sites par an), état actuel ou fin d'année précédente | Tableau de bord Grafana « Sites CENCA » (vues `sitcenca.synth_*`) |
| `indicateurs_activite` | Animations et plans de gestion de l'année précédente, parcelles questionnées en animation foncière | Grafana (`opeautres.synth_*_n-1`, `irenee.histo_foncier`) |
| `controle_donnees_sites` | Sites gérés sans géométrie, sans acte (ou acte sans parcelle), avec données manquantes | Grafana |

Les outils qui portent sur un site (`fiche_site`, `geometrie_site`, `foncier_site`, `travaux_site`, `webobs_site`) acceptent son code, son uuid ou son nom (même partiel). Les recherches de texte (noms de sites et de communes, milieux, titres, espèces) ignorent la casse, les accents, la ponctuation (« Colombey-les-Deux-Églises » = « Colombey les Deux Eglises ») et les abréviations « St » / « Ste » (`texteNormalise` dans `fonctions/utilitaires.js`). C'est utile car la base des sites écrit les communes sans traits d'union, alors que WebObs les écrit avec.

**Observations naturalistes WebObs** (base `natobs`, autre serveur PostgreSQL, déclarés seulement si `WEBOBS_DB_HOST` est renseigné ; requêtes prédéfinies, jamais de SQL libre sur cette base) :

| Outil | Rôle |
|---|---|
| `webobs_statistiques` | Observations, espèces et observateurs par année, groupe, faune/flore, département ou commune |
| `webobs_especes` | Espèces observées avec statuts (protections, directives, ZNIEFF), listes rouges, rareté ; plus/moins observées, récentes |
| `webobs_site` | Observations dans l'emprise d'un site du CENCA (tampon possible) : synthèse par groupe et liste des espèces |
| `webobs_sites_cenca` | Tous les sites gérés croisés avec les observations : richesse, espèces protégées/menacées/patrimoniales, sites où une espèce est présente, sites les moins prospectés |

Les deux bases étant sur deux serveurs, le MCP lit les géométries des sites dans la base des sites et les envoie à `natobs` (EWKB, reprojetées en WGS84 pour l'index spatial des observations). Les observations localisées seulement à la commune ne sont jamais rattachées à un site. Les espèces sensibles (sensibilité, floutage ou non diffusables) sont regroupées sous un nom masqué à l'échelle du site et de la commune. **`export_obs.webobs` a des colonnes décalées d'un cran à partir de `i`** (une colonne manque dans l'en-tête de l'import) : voir l'en-tête de `fonctions/requetesWebobs.js`.

**Outils génériques** : `lister_schemas`, `lister_tables`, `decrire_table` (avec la définition SQL des vues), `relations_schema`, `rechercher_colonnes`, `executer_requete` (SQL libre en lecture), plus la ressource `schema://base` et le prompt `bilan_site`.

Les `numeric` et `bigint` sont renvoyés en chaînes (aucune erreur d'arrondi), les dates telles qu'en base. Les géométries brutes (WKB) ne sont jamais renvoyées : Claude doit passer par `ST_AsGeoJSON`, `ST_Area`…

## Sécurité (défense en profondeur)

1. **Rôle PostgreSQL en lecture seule** : c'est la vraie barrière, voir ci-dessous. ⚠️ Il n'existe pas encore.
2. **Transaction `READ ONLY` toujours annulée** : chaque requête s'exécute dans `BEGIN READ ONLY … ROLLBACK`, avec `statement_timeout` (`MCP_QUERY_TIMEOUT_MS`) et `lock_timeout` de 5 s. La session est aussi en `default_transaction_read_only`, ce qui est vérifié au démarrage.
3. **Protocole étendu** de PostgreSQL : un seul ordre SQL par appel, impossible d'enchaîner `SELECT 1; DROP …`.
4. **Filtre SQL** : lectures uniquement (`SELECT`, `WITH`, `VALUES`, `TABLE`, `EXPLAIN`, `SHOW`). Sont refusés `SELECT INTO`, `FOR UPDATE`, les CTE modifiantes, et les fonctions `pg_sleep`, `set_config`, `pg_terminate_backend`, `dblink`, `lo_*`, `pg_read_file`, `query_to_xml`, `nextval`… L'analyse ignore correctement chaînes, `E'…'`, `$$…$$` et commentaires (tests dans `test/`).
5. **Données sensibles** : au démarrage, le serveur recense toutes les colonnes dont le nom évoque un secret (`hash`, `passw`, `mdp`, `token`, `secret`, `salt`). Elles sont refusées dans les requêtes et retirées des résultats, même via `SELECT *` ou un alias. `admin.blacklist_token` est inaccessible. Toute valeur ressemblant à une empreinte bcrypt ou à un JWT est masquée, même via `row_to_json`. Aucune requête ne part tant que ce recensement n'a pas réussi.
6. **Réseau** : écoute sur `MCP_HOST` (`127.0.0.1` par défaut), filtre IP `ALLOWED_IPS` (CIDR), jeton `Authorization: Bearer` (`MCP_API_TOKEN`) comparé à temps constant.
7. Résultats plafonnés à `MCP_MAX_ROWS` lignes (le `LIMIT` est appliqué par PostgreSQL). Chaque appel est journalisé.

> ⚠️ **À faire : demander un rôle lecture seule à 3liz.** Pour l'instant le `.env` réutilise `admincenca`, qui a tous les droits d'écriture. Les protections 2 à 7 tiennent, mais un rôle sans droit d'écriture reste la seule garantie absolue. `admincenca` n'a pas `CREATEROLE` (Lizmap SaaS), et les groupes `__group__restricted__` existants peuvent aussi écrire. Le script [`documentation/role_lecture_seule.sql`](documentation/role_lecture_seule.sql) contient la partie à faire par 3liz (création du rôle) et celle à exécuter ensuite avec `admincenca` (droits `SELECT`, `admin.salaries` sans `sal_hash`). Il suffira ensuite de changer `DB_USER` / `DB_PASSWORD` dans `mcp/.env`.

## Installation

```bash
cp mcp/.env_exemple mcp/.env       # puis compléter (déjà fait sur le poste de dev)
docker compose up -d --build mcp_sites   # depuis la racine du backend ; sans Docker : cd mcp && npm install && npm start
curl http://127.0.0.1:8891/health   # {"status":"ok","db":"ok"} (remplacer 127.0.0.1 par MCP_HOST)
cd mcp && npm test                  # tests hors ligne des garde-fous SQL
```

### Variables `mcp/.env`

| Variable | Rôle |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Connexion PostgreSQL (rôle lecture seule dès qu'il existe) |
| `MCP_HOST` | Interface d'écoute : `127.0.0.1` = cette machine uniquement ; IP LAN/VPN pour l'ouvrir aux collègues |
| `MCP_PORT` | Port (défaut 8891 ; le MCP taktik utilise 8890) |
| `MCP_API_TOKEN` | Jeton partagé avec le client Claude (`openssl rand -hex 32`) |
| `ALLOWED_IPS` | IP/CIDR autorisées, ex. `127.0.0.1,192.168.1.0/24,10.8.0.0/24` |
| `MCP_MAX_ROWS` | Lignes max renvoyées par requête (défaut 2000) |
| `MCP_QUERY_TIMEOUT_MS` | Timeout par requête (défaut 30000) |
| `MCP_DB_MAX_CONNEXIONS` | Taille du pool (défaut 4, par base) |
| `WEBOBS_DB_HOST`, `WEBOBS_DB_PORT`, `WEBOBS_DB_NAME`, `WEBOBS_DB_USER`, `WEBOBS_DB_PASSWORD` | Base WebObs (`natobs` sur 192.168.1.25) ; sans `WEBOBS_DB_HOST`, pas d'outils WebObs. Rôle lecture seule : [`documentation/role_lecture_seule_webobs.sql`](documentation/role_lecture_seule_webobs.sql) |

### Docker

Le service `mcp_sites` est déclaré dans le `docker-compose.yml` **racine du backend**, à côté de `node_app`, `prometheus` et `surveillance`. Les commandes se lancent donc depuis la racine, en nommant le service pour ne toucher qu'à lui :

```bash
docker compose up -d --build mcp_sites            # construit et lance (restart: unless-stopped)
docker compose ps mcp_sites                       # état + healthcheck
docker logs -f cenca_mcp_sites                    # journal des requêtes de Claude
docker compose up -d --force-recreate mcp_sites   # après modification de mcp/.env
docker compose up -d --build mcp_sites            # après modification du code ou de documentation/
```

Script de maintenance (depuis n'importe quel dossier) : `./mcp/maintenance_mcp.sh statut | logs | tests | reconstruire | redemarrer | arreter | demarrer | outils | nettoyer`. `reconstruire` enchaîne tests, build, suppression puis recréation du container (contourne le `KeyError: 'ContainerConfig'` de `docker-compose` 1.29.2) et attend qu'il soit healthy. `redemarrer` ne relit pas `mcp/.env` : après une modification du `.env`, utiliser `reconstruire`. Le script est exclu par le `*.sh` du `.gitignore` : le versionner avec `git add -f`.

Un `docker compose up -d` global le démarre aussi. Le container n'est recréé que si sa configuration ou son image ont changé.

- `network_mode: host` : le service n'est rattaché à **aucun réseau du compose**, ni au réseau `monitoring` ni au réseau par défaut. Docker interdit de combiner `network_mode` et `networks:`. Il ne voit donc pas `node_app`, `prometheus` ou `surveillance`, et ces services ne le voient pas non plus.
- Pas de `ports:` : le serveur écoute directement sur `MCP_HOST:MCP_PORT`. Docker ne publie aucun port et ne peut pas contourner le pare-feu comme le ferait `ports: "8891:8891"`.
- Il charge seulement `mcp/.env` (`env_file`), jamais le `.env` du backend.
- Container durci : utilisateur `node` non-root, système de fichiers en lecture seule, aucune capability. Le `.env` n'est pas copié dans l'image.

## Brancher Claude

> Les connecteurs ajoutés depuis claude.ai passent par le cloud d'Anthropic : ils **ne peuvent pas** joindre un serveur local. Il faut une configuration **locale**.

Remplacer `JETON` par la valeur de `MCP_API_TOKEN` (et `127.0.0.1` par l'IP du serveur si `MCP_HOST` est ouvert au LAN/VPN).

### Claude Code

```bash
claude mcp add --transport http cenca-sites http://127.0.0.1:8891/mcp \
  --header "Authorization: Bearer JETON"
```

### Claude Desktop

Fichier `claude_desktop_config.json` (*Paramètres > Développeur > Modifier la config*), Node.js requis :

```json
{
  "mcpServers": {
    "cenca-sites": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:8891/mcp", "--allow-http",
               "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer JETON" }
    }
  }
}
```

## Architecture

```
serveur_mcp.js               Point d'entrée Express, filtre IP + jeton, transport MCP Streamable HTTP (stateless)
dbPool.js                    Pool pg dédié (4 connexions), session en lecture seule
fonctions/securiteSql.js     Validation lecture seule, exécution en transaction READ ONLY + ROLLBACK, masquage
fonctions/securiteReseau.js  Filtre IP (CIDR) et vérification du jeton
fonctions/outilsMcp.js       Outils génériques (schéma, SQL libre), ressource et prompt
fonctions/requetesMetier.js  Outils métier (sites, foncier, travaux, spatial) + documentation_base
fonctions/utilitaires.js     Formatage des réponses, journalisation, lecture
documentation/               Guide métier lu par Claude, script du rôle lecture seule
test/                        Tests hors ligne des garde-fous (npm test)
```

Pour ajouter un outil métier, copier un bloc `outil(server, ...)` dans `fonctions/requetesMetier.js`, puis le citer dans `documentation/base_sites_cenca.md`.
