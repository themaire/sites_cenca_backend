// Charger les variables d'environnement
require('dotenv').config();

// Utiliser la clé secrète depuis le fichier .env
const PG_USER = process.env.DB_USER;
const PG_HOST = process.env.DB_HOST;
const PG_DB = process.env.DB_NAME;
const PG_PASSWORD = process.env.DB_PASSWORD;
const PG_PORT = process.env.DB_PORT;

// Create a new Postgresql client
const { Client, Pool } = require("pg");

const dbConfig = {
  user: String(PG_USER),
  host: String(PG_HOST),
  database: String(PG_DB),
  password: String(PG_PASSWORD),
  port: PG_PORT,
  idleTimeoutMillis: 1200000, // Timeout après 2 minutes d'inactivité
  max: 20, // Limite de connexions simultanées
  keepAlive: true, // Active le keep-alive
  application_name: 'node_pgsql_backend', // Nom de l'application
};

const pool = new Pool(dbConfig);
connectPool(pool); // Appelle la fonction pour initialiser le pool

// Fonction pour envoyer une requête "keep-alive" toutes les X minutes
setInterval(async () => {
  try {
    await pool.query("SELECT 1"); // Requête légère pour garder la connexion active
    console.log("Keep-alive envoyé à PostgreSQL");
  } catch (err) {
    console.error("Erreur lors du keep-alive :", err);
    connectPool(pool); // Appelle la fonction de reconnexion en cas d'erreur
  }
}, 5 * 60 * 1000); // Toutes les 5 minutes

// pool.connect().then(() => {
//     console.log("Connected to PostgreSQL database");
//   })
//   .catch((err) => {
//     console.error("Error connecting to PostgreSQL database", err);
//   });
// //  The Pool is ready to serve various query depending

/**
 * Fonction pour initialiser ou réinitialiser le pool PostgreSQL.
 * Elle tente de se connecter au pool et réessaye en cas d'échec.
 */
async function connectPool(pool) {
  if (!pool) {
    console.error("Le pool PostgreSQL n'est pas défini !");
    return;
  }
  try {
    const client = await pool.connect();
    console.log("Connexion réussie à PostgreSQL");
    client.release();
  } catch (err) {
    console.error("Erreur lors de la connexion à PostgreSQL :", err);
    // Réessaye après 5 secondes si la connexion échoue
    setTimeout(connectPool, 5000);
  }
}

// Gestion des erreurs dans le pool
pool.on('error', (err) => {
  console.error('Erreur dans le pool PostgreSQL :', err);
  connectPool(); // Appelle la fonction pour réinitialiser le pool
});

setInterval(() => {
  console.log(`Connexions actives dans le pool : ${pool.totalCount}`);
  console.log(`Connexions en attente : ${pool.waitingCount}`);
}, 60 * 1000); // Toutes les minutes

module.exports = pool;