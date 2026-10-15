# Serveur MCP — lecture seule de la base CENCA

Petit serveur [MCP](https://modelcontextprotocol.io) (transport stdio) pour interroger
localement la base PostgreSQL CENCA depuis un assistant (Claude Code, Claude Desktop…).
Indépendant de l'API Express : il a son propre `package.json` et son propre pool.

## Installation

```bash
cd mcp && npm install
```

La configuration est lue dans le `.env` à la racine du dépôt (`DB_HOST`, `DB_NAME`,
`DB_PORT`, `DB_USER`, `DB_PASSWORD`).

| Variable optionnelle | Rôle | Défaut |
|---|---|---|
| `MCP_ENV_FILE` | Chemin d'un autre fichier `.env` | `../.env` |
| `MCP_DB_USER`, `MCP_DB_PASSWORD` | Rôle dédié (recommandé : droits SELECT uniquement) | `DB_USER` / `DB_PASSWORD` |
| `MCP_MAX_ROWS` | Lignes max renvoyées par requête | `500` |
| `MCP_STATEMENT_TIMEOUT_MS` | Timeout par requête | `15000` |

## Outils exposés

- `lister_schemas` — schémas et commentaires
- `lister_tables` — tables/vues d'un schéma, lignes estimées, commentaires
- `decrire_table` — colonnes, types, commentaires, contraintes (PK, FK…)
- `executer_requete` — une requête SQL en lecture seule

## Garde-fous lecture seule

- session ouverte avec `default_transaction_read_only=on` ;
- chaque requête dans une transaction `READ ONLY` terminée par `ROLLBACK` ;
- protocole étendu : une seule instruction par appel (`COMMIT; DELETE …` refusé) ;
- `statement_timeout` et nombre de lignes limités.

Pour une sécurité complète, créer un rôle en lecture seule, par exemple :

```sql
CREATE ROLE mcp_lecture LOGIN PASSWORD '...';
GRANT pg_read_all_data TO mcp_lecture;  -- PostgreSQL ≥ 14
```

## Utilisation

**Claude Code** : le fichier `.mcp.json` à la racine du dépôt déclare le serveur
`cenca-bdd`, proposé automatiquement à l'ouverture du projet. Ou manuellement :

```bash
claude mcp add cenca-bdd -- node /chemin/vers/node_pgsql/mcp/server.js
```

**Claude Desktop** (`claude_desktop_config.json`) :

```json
{
  "mcpServers": {
    "cenca-bdd": { "command": "node", "args": ["/chemin/vers/node_pgsql/mcp/server.js"] }
  }
}
```

Le serveur écrit ses logs sur stderr uniquement (stdout est réservé au protocole).
