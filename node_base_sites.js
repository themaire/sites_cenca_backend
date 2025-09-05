"use strict";

// Charger les variables d'environnement
require('dotenv').config();

// Utiliser la clé secrète depuis le fichier .env
const NODE_PORT = process.env.NODE_PORT;

var express = require("express");
var axios = require("axios"); // Utiliser axios pour les requêtes HTTP
var app = express();
var cors = require("cors");
app.listen(NODE_PORT);
app.use(cors()); // Pour permettre le cross origin
app.use(express.json()); // Pour traiter les requêtes JSON
app.use(express.urlencoded({ extended: true })); // Pour traiter les requêtes encodées en URL

// Importation des routes
const userRoutes = require('./routes/userRoutes');
const siteRoutesGet = require('./routes/getSitesRoutes');
const siteRoutesPut = require('./routes/putSitesRoutes');
const menuRoutes = require('./routes/menuRoutes');
const foncierRoutes = require('./routes/foncierRoutes');

async function run() {
  try {
    app.use('/auth', userRoutes);
    app.use('/sites', siteRoutesGet);
    app.use('/sites', siteRoutesPut);
    app.use('/menu', menuRoutes);
    app.use('/sites', foncierRoutes);
  } catch (error) {
    console.error("Error try :" + error);
    pool.end();
  }
}

run().catch(console.dir);
