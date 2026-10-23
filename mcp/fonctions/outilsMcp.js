"use strict";

const { z } = require('zod');
const { pool } = require('../dbPool');
const { validerRequeteLecture, executerLectureSeule, estTableSensible, estColonneSensible } = require('./securiteSql');
const { enregistrerRequetesMetier } = require('./requetesMetier');
const { enregistrerRequetesWebobs } = require('./requetesWebobs');
const { enregistrerRequetesHabitats } = require('./requetesHabitats');
const { poolWebobs } = require('../dbPoolWebobs');
const { LECTURE_SEULE, MAX_ROWS, QUERY_TIMEOUT_MS, reponse, erreur, journaliser, lire } = require('./utilitaires');

/** Schémas système, de sauvegarde ou d'archive : masqués par défaut dans lister_schemas */
const SCHEMAS_SYSTEME = "^(pg_|information_schema$)";

/** Identifiant SQL entre guillemets (nom de colonne, table) */
const identifiant = (nom) => `"${String(nom).replace(/"/g, '""')}"`;

/**
 * Enregistre les outils, ressources et prompts sur une instance McpServer.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
function enregistrerOutils(server) {

  // Outils métier (sites, foncier, travaux, spatial) + documentation_base
  enregistrerRequetesMetier(server);
  enregistrerRequetesHabitats(server);

  // Observations naturalistes WebObs (autre base), croisées avec les emprises des sites
  if (poolWebobs) enregistrerRequetesWebobs(server);

  // ---------------------------------------------------------------- Schéma
  server.registerTool('lister_schemas', {
    title: 'Lister les schémas',
    description: "Liste les schémas PostgreSQL accessibles (sitcenca, esp, opegerer, docplan, ann, terr…) avec leur nombre de tables et de vues et leur commentaire. Les schémas datés (ex. hab_20260605) sont des copies de sauvegarde à ignorer sauf demande explicite.",
    inputSchema: {},
    annotations: LECTURE_SEULE,
  }, async () => {
    journaliser('lister_schemas');
    try {
      return reponse(await lire(`
        SELECT n.nspname AS schema,
               count(c.oid) FILTER (WHERE c.relkind IN ('r', 'p', 'f')) AS tables,
               count(c.oid) FILTER (WHERE c.relkind IN ('v', 'm')) AS vues,
               obj_description(n.oid, 'pg_namespace') AS commentaire,
               n.nspname ~ '_\\d{8}$' AS copie_datee
        FROM pg_namespace n
        LEFT JOIN pg_class c ON c.relnamespace = n.oid
        WHERE n.nspname !~ $1 AND has_schema_privilege(n.oid, 'USAGE')
        GROUP BY n.oid, n.nspname
        ORDER BY n.nspname`, [SCHEMAS_SYSTEME]));
    } catch (e) {
      return erreur(e.message);
    }
  });

  server.registerTool('lister_tables', {
    title: 'Lister les tables',
    description: "Liste les tables et vues d'un schéma avec leur nombre de lignes estimé, leur commentaire et leurs colonnes géométriques (type, SRID).",
    inputSchema: {
      schema: z.string().describe('Nom du schéma (ex. sitcenca, esp, opegerer)'),
    },
    annotations: LECTURE_SEULE,
  }, async ({ schema }) => {
    journaliser('lister_tables', schema);
    try {
      const tables = await lire(`
        SELECT c.relname AS table,
               CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table' WHEN 'v' THEN 'vue'
                              WHEN 'm' THEN 'vue matérialisée' WHEN 'f' THEN 'table externe' END AS type,
               CASE WHEN c.reltuples >= 0 THEN c.reltuples::bigint END AS lignes_estimees,
               obj_description(c.oid, 'pg_class') AS commentaire,
               (SELECT string_agg(g.f_geometry_column || ' ' || g.type || ' ' || g.srid, ', ')
                FROM public.geometry_columns g
                WHERE g.f_table_schema = n.nspname AND g.f_table_name = c.relname) AS geometries
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        ORDER BY c.relname`, [schema]);
      if (tables.length === 0) return erreur(`Schéma "${schema}" vide ou introuvable. Utiliser lister_schemas.`);
      return reponse(tables.filter(t => !estTableSensible(t.table)));
    } catch (e) {
      return erreur(e.message);
    }
  });

  server.registerTool('decrire_table', {
    title: 'Décrire une table',
    description: "Donne les colonnes d'une table ou d'une vue (type, nullabilité, valeur par défaut, commentaire), sa clé primaire, ses clés étrangères, la définition SQL si c'est une vue, et quelques lignes d'exemple (géométries résumées).",
    inputSchema: {
      schema: z.string().describe('Nom du schéma'),
      table: z.string().describe('Nom exact de la table ou de la vue'),
      exemples: z.number().int().min(0).max(20).default(5).describe("Nombre de lignes d'exemple à renvoyer"),
    },
    annotations: LECTURE_SEULE,
  }, async ({ schema, table, exemples }) => {
    journaliser('decrire_table', `${schema}.${table}`);
    if (estTableSensible(table)) return erreur(`Table "${table}" non accessible (jetons d'authentification).`);
    try {
      const [relation] = await lire(`
        SELECT c.oid::int AS oid, c.relkind AS type, obj_description(c.oid, 'pg_class') AS commentaire,
               CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true) END AS definition_vue
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r', 'p', 'v', 'm', 'f')`, [schema, table]);
      if (!relation) return erreur(`Table "${schema}.${table}" introuvable. Utiliser lister_tables.`);

      const colonnes = (await lire(`
        SELECT a.attname AS colonne, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable,
               pg_get_expr(d.adbin, d.adrelid) AS defaut, col_description(a.attrelid, a.attnum) AS commentaire,
               t.typname IN ('geometry', 'geography') AS geometrie
        FROM pg_attribute a
        JOIN pg_type t ON t.oid = a.atttypid
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`, [relation.oid])).filter(c => !estColonneSensible(c.colonne));

      const contraintes = await lire(`
        SELECT conname AS nom, CASE contype WHEN 'p' THEN 'clé primaire' WHEN 'f' THEN 'clé étrangère' WHEN 'u' THEN 'unique' END AS type,
               pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = $1 AND contype IN ('p', 'f', 'u')
        ORDER BY contype, conname`, [relation.oid]);

      let lignesExemple = [];
      if (exemples > 0 && colonnes.length > 0) {
        // Géométries résumées (type, nb de points, surface en ha) plutôt qu'en WKB illisible
        const selection = colonnes.map(c => c.geometrie
          ? `CASE WHEN ${identifiant(c.colonne)} IS NOT NULL THEN ST_GeometryType(${identifiant(c.colonne)}::geometry) || ' ; ' || ST_NPoints(${identifiant(c.colonne)}::geometry) || ' points ; ' || round((ST_Area(${identifiant(c.colonne)}::geometry) / 10000)::numeric, 2) || ' ha' END AS ${identifiant(c.colonne)}`
          : identifiant(c.colonne)).join(', ');
        ({ rows: lignesExemple } = await executerLectureSeule(pool,
          `SELECT ${selection} FROM ${identifiant(schema)}.${identifiant(table)} LIMIT ${exemples}`, [], { timeoutMs: QUERY_TIMEOUT_MS }));
      }

      return reponse({
        table: `${schema}.${table}`,
        commentaire: relation.commentaire,
        colonnes,
        contraintes,
        definition_vue: relation.definition_vue || undefined,
        exemples: lignesExemple,
      });
    } catch (e) {
      return erreur(e.message);
    }
  });

  server.registerTool('relations_schema', {
    title: 'Relations entre tables',
    description: "Liste les clés étrangères déclarées (table.colonne -> table.colonne), éventuellement pour un schéma. Beaucoup de liens de cette base ne sont PAS déclarés : se fier aussi à documentation_base et aux noms de colonnes (site -> sitcenca.sites.uuid_site, espace -> esp.espaces.uuid_espace…).",
    inputSchema: {
      schema: z.string().optional().describe('Restreindre aux tables de ce schéma (source ou cible)'),
    },
    annotations: LECTURE_SEULE,
  }, async ({ schema }) => {
    journaliser('relations_schema', schema || '');
    try {
      const lignes = await lire(`
        SELECT src_ns.nspname || '.' || src.relname AS table_source,
               (SELECT string_agg(a.attname, ', ') FROM unnest(con.conkey) k JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k) AS colonnes_source,
               cib_ns.nspname || '.' || cib.relname AS table_cible,
               (SELECT string_agg(a.attname, ', ') FROM unnest(con.confkey) k JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k) AS colonnes_cible
        FROM pg_constraint con
        JOIN pg_class src ON src.oid = con.conrelid
        JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
        JOIN pg_class cib ON cib.oid = con.confrelid
        JOIN pg_namespace cib_ns ON cib_ns.oid = cib.relnamespace
        WHERE con.contype = 'f'
          AND src_ns.nspname !~ $1
          AND ($2::text IS NULL OR src_ns.nspname = $2 OR cib_ns.nspname = $2)
        ORDER BY 1, 2`, [SCHEMAS_SYSTEME, schema || null]);
      return reponse(lignes.length ? lignes : { info: 'Aucune clé étrangère déclarée : déduire les jointures de documentation_base et des noms de colonnes.' });
    } catch (e) {
      return erreur(e.message);
    }
  });

  server.registerTool('rechercher_colonnes', {
    title: 'Rechercher une colonne',
    description: "Trouve les tables et vues qui contiennent une colonne dont le nom ressemble au motif (ex. 'insee', 'uuid_site', 'surface'). Utile pour découvrir les jointures non déclarées.",
    inputSchema: {
      motif: z.string().min(2).describe('Partie du nom de colonne (insensible à la casse)'),
    },
    annotations: LECTURE_SEULE,
  }, async ({ motif }) => {
    journaliser('rechercher_colonnes', motif);
    try {
      const lignes = await lire(`
        SELECT n.nspname AS schema, c.relname AS table, a.attname AS colonne, format_type(a.atttypid, a.atttypmod) AS type,
               CASE WHEN c.relkind IN ('v', 'm') THEN 'vue' ELSE 'table' END AS nature
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND n.nspname !~ $1 AND n.nspname !~ '_\\d{8}$'
          AND a.attname ILIKE '%' || $2 || '%'
        ORDER BY n.nspname, c.relname, a.attnum
        LIMIT 500`, [SCHEMAS_SYSTEME, motif]);
      return reponse(lignes.filter(l => !estColonneSensible(l.colonne) && !estTableSensible(l.table)));
    } catch (e) {
      return erreur(e.message);
    }
  });

  // ---------------------------------------------------------------- Requêtes
  server.registerTool('executer_requete', {
    title: 'Exécuter une requête SQL (lecture seule)',
    description: [
      'Exécute UNE requête SQL PostgreSQL/PostGIS en lecture seule (SELECT, WITH, VALUES, TABLE, EXPLAIN, SHOW) et renvoie les lignes.',
      'Toute modification est refusée. Préférer les agrégations côté SQL (count, sum, GROUP BY) plutôt que de rapatrier des milliers de lignes.',
      `Résultat tronqué à ${MAX_ROWS} lignes. Les numeric/bigint sont renvoyés en chaînes pour conserver leur précision.`,
      'Géométries en Lambert 93 (SRID 2154, mètres) : ST_Area(geom)/10000 donne des hectares ; pour afficher une géométrie, ST_AsGeoJSON(ST_Transform(geom, 4326), 6) (les géométries brutes ne sont pas renvoyées).',
      'Utiliser des paramètres $1, $2… + "parametres" pour les valeurs saisies. Pour la recherche de texte sans accents : unaccent(nom) ILIKE unaccent($1).',
    ].join(' '),
    inputSchema: {
      requete: z.string().describe('Requête SQL de lecture'),
      parametres: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).default([])
        .describe('Valeurs liées aux $1, $2… de la requête, dans l\'ordre'),
    },
    annotations: LECTURE_SEULE,
  }, async ({ requete, parametres }) => {
    journaliser('executer_requete', requete.replace(/\s+/g, ' ').slice(0, 300));
    try {
      const { sql, limitable } = validerRequeteLecture(requete);
      const debut = Date.now();
      const { rows, fields } = await executerLectureSeule(pool, sql, parametres,
        { timeoutMs: QUERY_TIMEOUT_MS, maxLignes: limitable ? MAX_ROWS : undefined });
      return reponse({
        nb_lignes: Math.min(rows.length, MAX_ROWS),
        tronque: rows.length > MAX_ROWS,
        duree_ms: Date.now() - debut,
        colonnes: fields.map(f => f.name),
        lignes: rows.slice(0, MAX_ROWS),
      });
    } catch (e) {
      return erreur(e.message);
    }
  });

  // ---------------------------------------------------------------- Ressource : schéma des tables principales
  server.registerResource('schema', 'schema://base', {
    title: 'Schéma de la base',
    description: 'Tables et colonnes des schémas métier (hors copies datées), en une fois.',
    mimeType: 'application/json',
  }, async (uri) => {
    const lignes = await lire(`
      SELECT n.nspname || '.' || c.relname AS t, a.attname AS c, format_type(a.atttypid, a.atttypmod) AS type
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm')
        AND n.nspname !~ $1 AND n.nspname !~ '_\\d{8}$' AND has_schema_privilege(n.oid, 'USAGE')
      ORDER BY 1, a.attnum`, [SCHEMAS_SYSTEME]);
    const schema = {};
    for (const l of lignes) {
      if (estColonneSensible(l.c) || estTableSensible(l.t.split('.')[1])) continue;
      (schema[l.t] ||= []).push(`${l.c} ${l.type}`);
    }
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(schema) }] };
  });

  // ---------------------------------------------------------------- Prompt : analyse d'un site
  server.registerPrompt('bilan_site', {
    title: "Bilan d'un site",
    description: 'Bilan complet d\'un site géré : identité, maîtrise foncière, documents de gestion, travaux réalisés et à venir.',
    argsSchema: {
      site: z.string().describe('Code ou nom du site'),
    },
  }, ({ site }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: [
          `Fais le bilan du site : ${site}.`,
          '1. Lis documentation_base, puis retrouve le site avec rechercher_sites et ouvre fiche_site.',
          '2. Maîtrise foncière : actes en cours, échéances proches (moins de 2 ans), surfaces par type de propriétaire (foncier_site).',
          '3. Gestion : document de gestion en vigueur et sa période de validité.',
          '4. Travaux : projets et opérations des 5 dernières années (operations_projet), en regroupant par type d\'action.',
          '5. Signale les incohérences (acte expiré mais site actif, plan de gestion échu, surface d\'actes très différente de la surface du site…).',
          'Fais les agrégations en SQL et cite tes sources (outil ou requête).',
        ].join('\n'),
      },
    }],
  }));
}

module.exports = { enregistrerOutils };
