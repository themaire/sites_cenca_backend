"use strict";

const { pool } = require('../dbPool');
const { poolWebobs } = require('../dbPoolWebobs');
const { executerLectureSeule } = require('./securiteSql');

const MAX_ROWS = Number(process.env.MCP_MAX_ROWS || 2000);
const QUERY_TIMEOUT_MS = Number(process.env.MCP_QUERY_TIMEOUT_MS || 30000);

const LECTURE_SEULE = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/**
 * Formate un résultat d'outil MCP (JSON lisible par Claude).
 */
function reponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function erreur(message) {
  return { content: [{ type: 'text', text: `Erreur : ${message}` }], isError: true };
}

/**
 * Journalise chaque appel d'outil (visible dans docker logs / la console).
 */
function journaliser(outil, detail = '') {
  const texte = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`[${new Date().toISOString()}] ${outil} ${texte}`.trim());
}

/**
 * Lecture simple (transaction READ ONLY, timeout) : renvoie les lignes.
 */
async function lire(sql, params = []) {
  const { rows } = await executerLectureSeule(pool, sql, params, { timeoutMs: QUERY_TIMEOUT_MS });
  return rows;
}

/**
 * Lecture sur la base WebObs (natobs), mêmes garde-fous de transaction ; requêtes prédéfinies uniquement.
 */
async function lireWebobs(sql, params = []) {
  if (!poolWebobs) throw new Error('Base WebObs non configurée (WEBOBS_DB_HOST absent de mcp/.env).');
  const rows = await executerLectureSeule(poolWebobs, sql, params, { timeoutMs: QUERY_TIMEOUT_MS, masquer: false });
  return rows;
}

/**
 * Expression SQL d'un texte normalisé pour la comparaison : minuscules, sans accents, ponctuation
 * (traits d'union, apostrophes…) réduite à une espace, « St » / « Ste » écrits « saint » / « sainte ».
 * « Colombey-les-Deux-Églises », « Colombey les Deux Eglises » → « colombey les deux eglises ».
 * `sansAccent` : expression SQL minuscule sans accents (unaccent par défaut ; natobs n'a pas l'extension).
 */
function texteNormalise(expr, sansAccent = e => `lower(unaccent(${e}))`) {
  return `btrim(regexp_replace(regexp_replace(regexp_replace(${sansAccent(expr)}, '[^a-z0-9]+', ' ', 'g'), '\\mste\\M', 'sainte', 'g'), '\\mst\\M', 'saint', 'g'))`;
}

/** Condition SQL : `colonne` contient `valeur` (expression ou paramètre $n), comparaison normalisée */
function contientTexte(colonne, valeur) {
  return `${texteNormalise(colonne)} LIKE '%' || ${texteNormalise(valeur)} || '%'`;
}

/**
 * Résultat tabulaire tronqué à MAX_ROWS lignes.
 */
function resultat(lignes, extra = {}) {
  return reponse({ ...extra, nb_lignes: lignes.length, tronque: lignes.length > MAX_ROWS, lignes: lignes.slice(0, MAX_ROWS) });
}

module.exports = { MAX_ROWS, QUERY_TIMEOUT_MS, LECTURE_SEULE, reponse, erreur, journaliser, lire, lireWebobs, resultat, texteNormalise, contientTexte };
