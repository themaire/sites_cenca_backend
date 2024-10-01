// Create a new Postgresql client
const { Client, Pool } = require("pg");

const dbConfig = {
  user: "postgres",
  host: "localhost",
  database: "lizmap_cenca_maps",
  password: "postgres",
  port: 5432,
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
