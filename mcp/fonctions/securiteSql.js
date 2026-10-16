"use strict";

/**
 * Garde-fous pour les requêtes SQL envoyées par Claude.
 *
 * Défense en profondeur, du plus fort au plus faible :
 *   1. (à obtenir de l'hébergeur) un rôle PostgreSQL avec SELECT uniquement, cf. documentation/role_lecture_seule.sql
 *   2. chaque requête s'exécute dans une transaction READ ONLY, toujours annulée (ROLLBACK),
 *      avec statement_timeout ; la session est aussi en default_transaction_read_only
 *   3. protocole étendu de PostgreSQL : un seul ordre SQL par appel, impossible d'en enchaîner
 *   4. ce filtre refuse tout ce qui n'est pas une lecture, et les fonctions dangereuses
 *   5. les colonnes sensibles (empreintes de mots de passe, jetons) sont retirées des résultats,
 *      et toute valeur qui ressemble à une empreinte bcrypt ou à un JWT est masquée
 */

/** Tables jamais accessibles (jetons de session révoqués) */
const TABLES_SENSIBLES = ['blacklist_token'];

/** Motif des noms de colonnes sensibles, recherché dans toute la base au démarrage */
const MOTIF_COLONNES_SENSIBLES = '(hash|passw|mdp|mot_de_passe|token|secret|salt)';

/** Valeurs masquées où qu'elles apparaissent (y compris via row_to_json, ::text, etc.) */
const MOTIFS_VALEURS_SENSIBLES = [
  /\$2[abxy]?\$\d{2}\$[./A-Za-z0-9]{53}/g,               // empreinte bcrypt
  /eyJ[\w-]{5,}\.eyJ[\w-]{5,}\.[\w-]{10,}/g,           // jeton JWT
];

/** Colonnes sensibles : noms (pour le filtre) et "oid_table:num_colonne" (pour masquer les résultats) */
let colonnesSensibles = { noms: new Set(['sal_hash']), positions: new Set() };

/** OID des types geometry / geography (PostGIS), chargés au démarrage */
let oidsGeometrie = new Set();
const GEOMETRIE_BRUTE = '[géométrie WKB non affichée : utiliser ST_AsGeoJSON(ST_Transform(col, 4326), 6), ST_AsText, ST_Area…]';

const PREMIERS_MOTS_AUTORISES = ['SELECT', 'WITH', 'VALUES', 'TABLE', 'EXPLAIN', 'SHOW'];
const PREMIERS_MOTS_LIMITABLES = ['SELECT', 'WITH', 'VALUES', 'TABLE'];

const MOTIFS_INTERDITS = [
  {
    regex: /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|LOCK|VACUUM|CLUSTER|REINDEX|REFRESH|LISTEN|UNLISTEN|NOTIFY|PREPARE|EXECUTE|DEALLOCATE|DISCARD|RESET|SET|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|IMPORT|CHECKPOINT|LOAD|SECURITY)\b/i,
    raison: "instruction de modification ou de session (si c'est un nom de colonne, l'entourer de \"guillemets\")",
  },
  { regex: /\bINTO\b/i, raison: 'SELECT INTO (création de table)' },
  { regex: /\bFOR\s+(NO\s+KEY\s+|KEY\s+)?(UPDATE|SHARE)\b/i, raison: 'verrouillage (FOR UPDATE / FOR SHARE)' },
  {
    regex: /\b(pg_sleep\w*|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_read_file|pg_read_binary_file|pg_ls_\w+|pg_stat_file|lo_\w+|dblink\w*|set_config|pg_(try_)?advisory\w*|pg_notify|(query|table|cursor|schema|database)_to_xml\w*|ts_stat|pg_logical\w*|pg_(create|drop)_\w+|pg_replication\w*|pg_switch_wal|pg_backup\w*|pg_promote|txid_current\w*|pg_current_xact_id\w*|nextval|setval|pg_stat_activity)\b/i,
    raison: 'fonction ou vue système non autorisée',
  },
];

/**
 * Retire commentaires et chaînes littérales pour analyser uniquement la structure de la requête
 * (évite les faux positifs sur WHERE remarque = 'à mettre à jour : UPDATE'). Règles PostgreSQL :
 * '...' sans échappement par antislash, E'...' avec, $tag$...$tag$, "identifiants".
 */
const JETONS_SQL = /(\/\*[\s\S]*?\*\/)|(--[^\n]*)|(\$([A-Za-z_][A-Za-z_0-9]*)?\$[\s\S]*?\$\4\$)|((?<![\w$])[eE]'(?:[^'\\]|\\.|'')*')|('(?:[^']|'')*')|("(?:[^"]|"")*")/g;

function nettoyerPourAnalyse(sql, garderIdentifiants = false) {
  // Une seule passe, de gauche à droite : un "--" dans une chaîne n'est pas pris pour un commentaire
  return sql.replace(JETONS_SQL, (jeton, blocCommentaire, ligneCommentaire, dollar, tag, chaineE, chaine, identifiant) => {
    if (blocCommentaire || ligneCommentaire) return ' ';
    if (identifiant) return garderIdentifiants ? ` ${identifiant.slice(1, -1).replace(/""/g, '"')} ` : '""';
    return "''";
  }).trim();
}

/**
 * Refuse les requêtes qui citent une table ou une colonne sensible.
 */
function verifierDonneesSensibles(sql) {
  const identifiants = nettoyerPourAnalyse(sql, true);
  const cite = (nom) => new RegExp(`(^|[^\\wÀ-ÿ])${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\wÀ-ÿ]|$)`, 'i').test(identifiants);

  const table = TABLES_SENSIBLES.find(cite);
  if (table) throw new Error(`Table "${table}" non accessible (jetons d'authentification).`);

  const colonne = [...colonnesSensibles.noms].find(cite);
  if (colonne) throw new Error(`Colonne "${colonne}" non accessible (mot de passe / jeton).`);
}

/**
 * Recense au démarrage toutes les colonnes sensibles de la base (tables et vues),
 * pour les refuser dans les requêtes et les retirer des résultats même via SELECT *.
 * @param {import('pg').Pool} pool
 */
async function chargerColonnesSensibles(pool) {
  const { rows } = await pool.query(`
    SELECT a.attrelid::int AS table_oid, a.attnum::int AS num, a.attname AS nom,
           n.nspname || '.' || c.relname || '.' || a.attname AS chemin
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE a.attnum > 0 AND NOT a.attisdropped
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname !~ '^(pg_|information_schema)'
      AND a.attname ~* $1`, [MOTIF_COLONNES_SENSIBLES]);
  colonnesSensibles = {
    noms: new Set(['sal_hash', ...rows.map(r => r.nom.toLowerCase())]),
    positions: new Set(rows.map(r => `${r.table_oid}:${r.num}`)),
  };
  return rows.map(r => r.chemin);
}

/**
 * Repère les types PostGIS pour ne pas renvoyer de géométries brutes (WKB hexadécimal, illisible et volumineux).
 * @param {import('pg').Pool} pool
 */
async function chargerTypesGeometrie(pool) {
  const { rows } = await pool.query("SELECT oid::int AS oid FROM pg_type WHERE typname IN ('geometry', 'geography')");
  oidsGeometrie = new Set(rows.map(r => r.oid));
  return oidsGeometrie.size;
}

/** Initialisation (types PostGIS + colonnes sensibles), réessayée tant qu'elle n'a pas réussi */
let initialisation = null;

function initialiser(pool) {
  initialisation ||= Promise.all([chargerTypesGeometrie(pool), chargerColonnesSensibles(pool)])
    .then(([, colonnes]) => colonnes)
    .catch((e) => { initialisation = null; throw e; });
  return initialisation;
}

function estTableSensible(table) {
  return TABLES_SENSIBLES.includes(String(table).toLowerCase());
}

function estColonneSensible(colonne) {
  return colonnesSensibles.noms.has(String(colonne).toLowerCase());
}

/**
 * Valide qu'une requête est une lecture simple. Lève une erreur explicite sinon.
 * @param {string} sql
 * @returns {{ sql: string, limitable: boolean }} requête sans point-virgule final ; limitable si on peut l'envelopper d'un LIMIT
 */
function validerRequeteLecture(sql) {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new Error('Requête vide.');
  }

  const requete = sql.trim().replace(/;\s*$/, '');
  const analyse = nettoyerPourAnalyse(requete);

  if (analyse.includes(';')) {
    throw new Error('Une seule requête à la fois (point-virgule interne détecté).');
  }

  const premierMot = (analyse.match(/^\(*\s*([A-Za-z]+)/) || [])[1]?.toUpperCase();
  if (!PREMIERS_MOTS_AUTORISES.includes(premierMot)) {
    throw new Error(`Seules les lectures sont autorisées (${PREMIERS_MOTS_AUTORISES.join(', ')}). Reçu : ${premierMot || '?'}`);
  }

  for (const { regex, raison } of MOTIFS_INTERDITS) {
    const trouve = analyse.match(regex);
    if (trouve) {
      throw new Error(`Requête refusée : ${raison} (« ${trouve[0]} »).`);
    }
  }

  verifierDonneesSensibles(requete);

  return { sql: requete, limitable: PREMIERS_MOTS_LIMITABLES.includes(premierMot) };
}

/**
 * Masque les valeurs sensibles dans une valeur quelconque (chaîne, objet JSON, tableau).
 */
function masquerValeur(valeur) {
  if (typeof valeur === 'string') {
    return MOTIFS_VALEURS_SENSIBLES.reduce((texte, motif) => texte.replace(motif, '[masqué]'), valeur);
  }
  if (Array.isArray(valeur)) return valeur.map(masquerValeur);
  if (valeur && typeof valeur === 'object' && !(valeur instanceof Date) && !Buffer.isBuffer(valeur)) {
    return Object.fromEntries(Object.entries(valeur).map(([cle, v]) => [cle, masquerValeur(v)]));
  }
  return valeur;
}

/**
 * Retire des résultats les colonnes sensibles d'après leur table et colonne d'ORIGINE
 * (fonctionne avec SELECT * ou un alias : "sal_hash AS h"), puis masque les valeurs suspectes.
 * Les géométries brutes sont remplacées par un message invitant à les convertir.
 */
function masquerResultats(rows, fields) {
  const aMasquer = (fields || [])
    .filter(f => colonnesSensibles.positions.has(`${f.tableID}:${f.columnID}`) || estColonneSensible(f.name))
    .map(f => f.name);
  const geometries = (fields || []).filter(f => oidsGeometrie.has(f.dataTypeID)).map(f => f.name);
  const lignes = rows.map(ligne => {
    const copie = {};
    for (const [cle, valeur] of Object.entries(ligne)) {
      if (aMasquer.includes(cle)) continue;
      copie[cle] = geometries.includes(cle) && valeur !== null ? GEOMETRIE_BRUTE : masquerValeur(valeur);
    }
    return copie;
  });
  return { rows: lignes, fields: (fields || []).filter(f => !aMasquer.includes(f.name)) };
}

/**
 * Exécute une requête validée dans une transaction READ ONLY toujours annulée, avec timeout.
 * @param {import('pg').Pool} pool
 * @param {string} sql requête déjà validée (ou écrite par un outil métier)
 * @param {Array} params paramètres liés ($1, $2…)
 * @param {{ timeoutMs?: number, maxLignes?: number }} options maxLignes : enveloppe la requête d'un LIMIT
 */
async function executerLectureSeule(pool, sql, params = [], { timeoutMs = 30000, maxLignes } = {}) {
  // Jamais de requête tant que les colonnes sensibles ne sont pas connues
  await initialiser(pool);
  const texte = maxLignes
    ? `SELECT * FROM (\n${sql}\n) AS resultat LIMIT ${Number(maxLignes) + 1}`
    : sql;
  const client = await pool.connect();
  let erreurConnexion;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${Math.trunc(Number(timeoutMs)) || 30000}`);
    await client.query("SET LOCAL lock_timeout = '5s'");
    // queryMode "extended" : un seul ordre SQL accepté, même sans paramètre
    const resultat = await client.query({ text: texte, values: params, queryMode: 'extended' });
    return masquerResultats(resultat.rows || [], resultat.fields);
  } finally {
    await client.query('ROLLBACK').catch((e) => { erreurConnexion = e; });
    // Connexion dans un état incertain : on la détruit plutôt que de la remettre dans le pool
    client.release(erreurConnexion);
  }
}

module.exports = {
  validerRequeteLecture,
  executerLectureSeule,
  initialiser,
  estTableSensible,
  estColonneSensible,
  masquerResultats,
  nettoyerPourAnalyse,
};
