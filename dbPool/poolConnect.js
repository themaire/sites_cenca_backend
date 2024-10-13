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
};

const pool = new Pool(dbConfig);

pool.connect().then(() => {
    console.log("Connected to PostgreSQL database");
  })
  .catch((err) => {
    console.error("Error connecting to PostgreSQL database", err);
  });
// The Pool is ready to serve various query depending

module.exports = pool;
