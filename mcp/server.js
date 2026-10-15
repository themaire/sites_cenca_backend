#!/usr/bin/env node
/**
 * Serveur MCP local, en lecture seule, sur la base PostgreSQL CENCA.
 *
 * Transport stdio : rien ne doit être écrit sur stdout en dehors du protocole,
 * tous les logs passent par console.error.
 *
 * Garde-fous lecture seule (cumulés) :
 *  - connexion ouverte avec default_transaction_read_only=on ;
 *  - chaque requête tourne dans une transaction READ ONLY puis ROLLBACK ;
 *  - protocole étendu (queryMode 'extended') : une seule instruction par appel,
 *    impossible d'enchaîner « COMMIT; DELETE ... » ;
 *  - statement_timeout et nombre de lignes renvoyées limités.
 * Idéalement, utiliser en plus un rôle PostgreSQL n'ayant que des droits SELECT
 * (variables MCP_DB_USER / MCP_DB_PASSWORD).
 */
const path = require('path');
require('dotenv').config({
  path: process.env.MCP_ENV_FILE || path.join(__dirname, '..', '.env'),
  quiet: true,
});

const { Pool } = require('pg');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const MAX_ROWS = parseInt(process.env.MCP_MAX_ROWS || '500', 10);
const TIMEOUT_MS = parseInt(process.env.MCP_STATEMENT_TIMEOUT_MS || '15000', 10);

const pool = new Pool({
  user: process.env.MCP_DB_USER || process.env.DB_USER,
  password: String(process.env.MCP_DB_PASSWORD || process.env.DB_PASSWORD),
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  max: 3,
  application_name: 'cenca_mcp_lecture',
  options: `-c default_transaction_read_only=on -c statement_timeout=${TIMEOUT_MS}`,
});
pool.on('error', (err) => console.error('[mcp] Erreur pool PostgreSQL :', err.message));

/**
 * Exécute une instruction SQL unique dans une transaction en lecture seule.
 */
async function lecture(sql, values = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    return await client.query({ text: sql, values, queryMode: 'extended' });
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

function texte(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
}

function erreur(err) {
  return { isError: true, content: [{ type: 'text', text: `Erreur PostgreSQL : ${err.message}` }] };
}

const server = new McpServer({ name: 'cenca-bdd-lecture', version: '1.0.0' });

server.registerTool(
  'lister_schemas',
  {
    description: 'Liste les schémas de la base CENCA (hors schémas système) avec leur commentaire.',
    inputSchema: {},
  },
  async () => {
    try {
      const { rows } = await lecture(`
        SELECT n.nspname AS schema, obj_description(n.oid, 'pg_namespace') AS commentaire
        FROM pg_namespace n
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        ORDER BY 1`);
      return texte(rows);
    } catch (err) {
      return erreur(err);
    }
  }
);

server.registerTool(
  'lister_tables',
  {
    description:
      "Liste les tables, vues et vues matérialisées d'un schéma (ou de tous), avec type, nombre de lignes estimé et commentaire.",
    inputSchema: { schema: z.string().optional().describe('Nom du schéma (ex : sitcenca). Vide = tous.') },
  },
  async ({ schema }) => {
    try {
      const { rows } = await lecture(
        `SELECT n.nspname AS schema, c.relname AS nom,
                CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table partitionnée'
                               WHEN 'v' THEN 'vue' WHEN 'm' THEN 'vue matérialisée'
                               WHEN 'f' THEN 'table étrangère' END AS type,
                CASE WHEN c.reltuples >= 0 THEN c.reltuples::bigint END AS lignes_estimees,
                obj_description(c.oid, 'pg_class') AS commentaire
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
           AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
           AND ($1::text IS NULL OR n.nspname = $1)
         ORDER BY 1, 2`,
        [schema || null]
      );
      return texte(rows);
    } catch (err) {
      return erreur(err);
    }
  }
);

server.registerTool(
  'decrire_table',
  {
    description:
      'Décrit une table ou une vue : colonnes (type, nullabilité, défaut, commentaire), clé primaire et clés étrangères.',
    inputSchema: {
      schema: z.string().describe('Nom du schéma'),
      table: z.string().describe('Nom de la table ou de la vue'),
    },
  },
  async ({ schema, table }) => {
    try {
      const colonnes = await lecture(
        `SELECT a.attname AS colonne, format_type(a.atttypid, a.atttypmod) AS type,
                NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS defaut,
                col_description(a.attrelid, a.attnum) AS commentaire
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attnum`,
        [schema, table]
      );
      if (colonnes.rows.length === 0) return texte(`Aucune table ou vue « ${schema}.${table} » trouvée.`);

      const contraintes = await lecture(
        `SELECT co.conname AS nom,
                CASE co.contype WHEN 'p' THEN 'clé primaire' WHEN 'f' THEN 'clé étrangère'
                                WHEN 'u' THEN 'unicité' WHEN 'c' THEN 'vérification' END AS type,
                pg_get_constraintdef(co.oid) AS definition
         FROM pg_constraint co
         JOIN pg_class c ON c.oid = co.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2
         ORDER BY co.contype, co.conname`,
        [schema, table]
      );
      return texte({ table: `${schema}.${table}`, colonnes: colonnes.rows, contraintes: contraintes.rows });
    } catch (err) {
      return erreur(err);
    }
  }
);

server.registerTool(
  'executer_requete',
  {
    description:
      'Exécute UNE requête SQL en lecture seule (SELECT, WITH, EXPLAIN, SHOW…) sur la base CENCA. ' +
      'Les écritures sont refusées par PostgreSQL. Géométries en SRID 2154 : utiliser ST_AsText / ST_AsGeoJSON ' +
      `pour les lire. Résultat tronqué à ${MAX_ROWS} lignes maximum.`,
    inputSchema: {
      sql: z.string().describe('Requête SQL (une seule instruction, sans point-virgule final multiple)'),
      limite: z.number().int().positive().optional().describe(`Nombre max de lignes renvoyées (≤ ${MAX_ROWS})`),
    },
  },
  async ({ sql, limite }) => {
    const max = Math.min(limite || MAX_ROWS, MAX_ROWS);
    try {
      const res = await lecture(sql.trim().replace(/;\s*$/, ''));
      const rows = res.rows || [];
      return texte({
        commande: res.command,
        nb_lignes: rows.length,
        tronque: rows.length > max,
        colonnes: (res.fields || []).map((f) => f.name),
        lignes: rows.slice(0, max),
      });
    } catch (err) {
      return erreur(err);
    }
  }
);

async function main() {
  await server.connect(new StdioServerTransport());
  console.error(`[mcp] cenca-bdd-lecture prêt (base ${process.env.DB_NAME}@${process.env.DB_HOST}, lecture seule)`);
}

async function arreter() {
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', arreter);
process.on('SIGTERM', arreter);

main().catch((err) => {
  console.error('[mcp] Échec du démarrage :', err);
  process.exit(1);
});
