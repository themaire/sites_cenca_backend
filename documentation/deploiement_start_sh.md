# Lancer et déployer le backend : `start.sh`

`start.sh`, à la racine du dépôt, lance le backend en développement (Node directement) ou en production (Docker Compose, HTTPS). C'est le script à utiliser pour redéployer la prod.

```bash
./start.sh <dev|prod> [options]
./start.sh -h          # aide
```

## En bref

| Je veux… | Commande |
|---|---|
| **Redéployer la prod après un `git pull`** | `./start.sh prod -b -d -r` |
| Redémarrer la prod sans reconstruire | `./start.sh prod -d -r` |
| Suivre les logs du backend en prod | `./start.sh prod -l` |
| Arrêter toute la prod | `./start.sh prod -s` |
| Lancer le dev (port 8887) dans le terminal | `./start.sh dev` |
| Lancer le dev en arrière-plan | `./start.sh dev -d` (logs : `tail -f dev.log`) |
| Arrêter le dev | `./start.sh dev -s` |
| Redéployer **seulement** le MCP | `./mcp/maintenance_mcp.sh reconstruire` |

## Options

| Option | Dev | Prod |
|---|---|---|
| *(aucune)* | `npm install` puis `npm start` au premier plan | `docker-compose up` au premier plan (Ctrl+C arrête tout) |
| `-d`, `--detach` | En arrière-plan : `nohup npm start`, sortie dans `dev.log`, PID dans `.dev_pid` | `up -d`, puis **vérification** de chaque service (voir plus bas) |
| `-b`, `--build` | Sans effet | **Tests du MCP puis build des images**, avant tout arrêt |
| `-r`, `--restart` | Arrête le processus Node puis relance | `down` (tous les conteneurs) puis relance |
| `-s`, `--stop` | Tue le processus `node … node_base_sites.js` | `down` : arrête et supprime **tous** les conteneurs du compose |
| `-l`, `--logs` | Rappelle seulement de lancer `./start.sh dev` | `logs -f node_app` (Ctrl+C pour sortir, la prod continue) |

Les options se combinent. Si plusieurs actions sont demandées, une seule s'exécute, dans cet ordre de priorité : `-s`, puis `-l`, puis `-r`, sinon démarrage simple. Ainsi `-s -b` arrête sans rien reconstruire.

## Production : ce que fait `./start.sh prod -b -d -r`

Les services du `docker-compose.yml` :

| Service | Conteneur | Image | Rôle |
|---|---|---|---|
| `node_app` | `node_pgsql_node_app_1` | construite depuis `.` | Backend HTTPS, port 8889 de l'hôte |
| `mcp_sites` | `cenca_mcp_sites` | construite depuis `./mcp` | Serveur MCP lecture seule (port 8891), utilisé par le chatbot Sonneur |
| `surveillance` | `cenca_surveillance` | construite avec `surveillance/Dockerfile` | Alertes Telegram |
| `prometheus` | `node_pgsql_prometheus_1` | téléchargée (`prom/prometheus`) | Métriques |

Les étapes, dans l'ordre :

1. **Contrôle des certificats** : le script s'arrête si `/etc/ssl/certs/si-10.cen-champagne-ardenne.org/privkey.pem` est absent.
2. **Tests du MCP** (`-b`) : `npm test` dans `mcp/`. Ce sont des tests unitaires hors ligne (sans base de données) des garde-fous SQL du MCP : requêtes de modification refusées, colonnes sensibles masquées… S'ils échouent, **rien n'est arrêté ni reconstruit**.
3. **Build des images** (`-b`) : `docker-compose build` de `node_app`, `mcp_sites` et `surveillance`. La prod tourne toujours pendant le build ; s'il échoue, elle reste en place.
4. **Arrêt** (`-r`) : `docker-compose down`. C'est seulement maintenant que la prod est coupée, et pour tous les services : Sonneur et la surveillance aussi.
5. **Démarrage** : `docker-compose up -d`, avec les images construites à l'étape 3.
6. **Vérification** (`-d`), jusqu'à 90 s :
   - chaque conteneur doit être `running` ;
   - `mcp_sites` doit en plus être `healthy`. C'est le seul service qui a un healthcheck (défini dans `mcp/Dockerfile`) : il interroge `/health`, donc la connexion PostgreSQL ;
   - le backend doit répondre en HTTPS sur `https://127.0.0.1:8889/`. N'importe quel code HTTP suffit : un 404 sur `/` est normal et prouve que le serveur écoute.

Sortie attendue à la fin :

```
🩺 Vérification des services (90 s max)...
✅ cenca_mcp_sites : running (healthy)
✅ cenca_surveillance : running
✅ node_pgsql_node_app_1 : running
✅ node_pgsql_prometheus_1 : running
✅ Backend : répond en HTTPS sur le port 8889 (HTTP 404)
✅ Prod opérationnelle
```

Si un service ne va pas, le script affiche ses 20 dernières lignes de log, puis `❌ La prod ne s'est pas relancée correctement`, et se termine avec le code 1.

### Codes de sortie

| Code | Signification |
|---|---|
| 0 | Tout va bien |
| 1 | Tests du MCP en échec, build en échec, certificats absents, option inconnue, ou prod pas relancée correctement |

## Pièges connus

- **Toujours mettre `-r` avec `-b` en prod.** `docker-compose` 1.29.2, installé sur ce serveur, plante quand il recrée un conteneur existant (`KeyError: 'ContainerConfig'`). Avec `-r`, le `down` supprime d'abord les conteneurs, et le problème ne se pose pas. `./start.sh prod -b -d` sans `-r` peut donc échouer. Si un conteneur reste bloqué : `docker-compose rm -sf node_app` (ou le service concerné), puis relancer.
- **Les tests du MCP tournent sur l'hôte**, pas dans Docker : il faut `npm` et `mcp/node_modules`. Après un clone ou une mise à jour des dépendances du MCP, faire une fois `cd mcp && npm install`.
- **Une modification du `.env` (racine ou `mcp/.env`) exige `-r`.** Un conteneur ne relit pas son `.env` tant qu'il n'est pas recréé.
- **`-r` coupe tous les services quelques secondes**, y compris Sonneur et la surveillance, qui peut alors envoyer une alerte Telegram. Pour ne toucher qu'au MCP : `./mcp/maintenance_mcp.sh reconstruire`, qui lance aussi les tests et attend le healthcheck.
- **En dev, `-s` arrête tout processus `node … node_base_sites.js`** de la machine, pas seulement celui lancé par `-d`.
- **`docker-compose.prod.yml` est conservé pour compatibilité** : `docker-compose.yml` contient déjà toute la configuration de production. Ne pas recréer de `docker-compose.override.yml` : il serait chargé automatiquement et a déjà fait démarrer la prod en HTTP.

## Voir aussi

- `mcp/maintenance_mcp.sh` (`statut`, `logs`, `tests`, `reconstruire`, `outils`…) : gestion du seul conteneur MCP, voir `mcp/README.md`.
- `test_backend.sh` : tests manuels des routes du backend (`--token` pour obtenir un JWT de test).
- `documentation/chatbot/fonctionnement_backend.md` : fonctionnement du chatbot Sonneur.
