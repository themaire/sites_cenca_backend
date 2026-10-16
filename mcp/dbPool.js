"use strict";

// Charger les variables d'environnement (mcp/.env)
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { Pool, types } = require('pg');

// numeric / bigint renvoyés en chaînes (comportement par défaut de pg) : aucune perte de précision.
// Les dates (sans heure) restent telles qu'en base, sans conversion de fuseau horaire.
types.setTypeParser(1082, (valeur) => valeur);

/**
 * Pool PostgreSQL dédié au serveur MCP, distinct de celui du backend (dbPool/poolConnect.js) :
 * - peu de connexions, pour ne jamais priver l'application métier
 * - chaque requête passe par une transaction READ ONLY toujours annulée (cf. fonctions/securiteSql.js)
 * - chaque session est en plus en lecture seule par défaut (default_transaction_read_only)
 */
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: Number(process.env.MCP_DB_MAX_CONNEXIONS || 4),
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  application_name: 'cenca_mcp_sites',
  // Chaque nouvelle connexion passe en lecture seule par défaut AVANT d'être confiée à qui que ce soit :
  // pg-pool attend ce hook, et s'il échoue la connexion est détruite et l'erreur remonte à l'appelant.
  // Le paramètre de démarrage "options" n'est pas utilisé car il peut être refusé par un proxy
  // de connexions côté hébergeur.
  onConnect: (client) => client.query('SET default_transaction_read_only = on'),
});

pool.on('error', (err) => {
  // Une connexion inactive coupée par le serveur ne doit pas faire tomber le processus
  console.error('Erreur PostgreSQL (connexion inactive) :', err.message);
});

/**
 * Vérifie la connexion au démarrage, la version de PostGIS et le mode lecture seule.
 */
async function testerConnexion() {
  const client = await pool.connect();
  let infos;
  try {
    await client.query('BEGIN READ ONLY');
    ({ rows: [infos] } = await client.query(`
      SELECT current_setting('server_version') AS version,
             current_setting('default_transaction_read_only') AS lecture_seule,
             (SELECT extversion FROM pg_extension WHERE extname = 'postgis') AS postgis`));
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
  if (infos.lecture_seule !== 'on') {
    throw Object.assign(new Error('La session PostgreSQL n\'est pas en lecture seule, arrêt par sécurité.'), { critique: true });
  }
  console.log(`Connexion réussie à PostgreSQL ${infos.version} (PostGIS ${infos.postgis || 'absent'}) - base "${process.env.DB_NAME}" - session en lecture seule`);
}

module.exports = { pool, testerConnexion };
