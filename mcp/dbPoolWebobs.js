"use strict";

// Charger les variables d'environnement (mcp/.env)
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { Pool } = require('pg');

/**
 * Pool PostgreSQL de la base WebObs (observations naturalistes, base natobs), sur un autre serveur
 * que la base des sites. Mêmes protections que dbPool.js : peu de connexions, session en lecture
 * seule par défaut, chaque requête dans une transaction READ ONLY annulée (securiteSql.js).
 * Seules les requêtes prédéfinies de requetesWebobs.js l'utilisent (pas de SQL libre).
 * null si WEBOBS_DB_HOST n'est pas renseigné : les outils WebObs ne sont alors pas déclarés.
 */
const poolWebobs = process.env.WEBOBS_DB_HOST ? new Pool({
  host: process.env.WEBOBS_DB_HOST,
  port: Number(process.env.WEBOBS_DB_PORT || 5432),
  user: process.env.WEBOBS_DB_USER,
  password: process.env.WEBOBS_DB_PASSWORD,
  database: process.env.WEBOBS_DB_NAME,
  max: Number(process.env.MCP_DB_MAX_CONNEXIONS || 4),
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  application_name: 'cenca_mcp_sites',
  onConnect: (client) => client.query('SET default_transaction_read_only = on'),
}) : null;

poolWebobs?.on('error', (err) => {
  console.error('Erreur PostgreSQL WebObs (connexion inactive) :', err.message);
});

/**
 * Vérifie la connexion WebObs au démarrage. Non bloquant : sans WebObs, le reste du MCP fonctionne.
 */
async function testerConnexionWebobs() {
  if (!poolWebobs) return console.log('WebObs : WEBOBS_DB_HOST absent, outils WebObs désactivés');
  const client = await poolWebobs.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const { rows: [infos] } = await client.query(`
      SELECT current_setting('default_transaction_read_only') AS lecture_seule,
             (SELECT max(to_date(date, 'DD/MM/YYYY'))::text FROM export_obs.webobs) AS derniere_observation`);
    if (infos.lecture_seule !== 'on') {
      throw Object.assign(new Error('La session PostgreSQL WebObs n\'est pas en lecture seule, arrêt par sécurité.'), { critique: true });
    }
    console.log(`Connexion réussie à WebObs - base "${process.env.WEBOBS_DB_NAME}" - observations jusqu'au ${infos.derniere_observation} - session en lecture seule`);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

module.exports = { poolWebobs, testerConnexionWebobs };
