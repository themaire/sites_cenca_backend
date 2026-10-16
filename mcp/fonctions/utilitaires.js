"use strict";

const { pool } = require('../dbPool');
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
 * Résultat tabulaire tronqué à MAX_ROWS lignes.
 */
function resultat(lignes, extra = {}) {
  return reponse({ ...extra, nb_lignes: lignes.length, tronque: lignes.length > MAX_ROWS, lignes: lignes.slice(0, MAX_ROWS) });
}

module.exports = { MAX_ROWS, QUERY_TIMEOUT_MS, LECTURE_SEULE, reponse, erreur, journaliser, lire, resultat };
