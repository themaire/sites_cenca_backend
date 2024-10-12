"use strict";

var express = require("express");
var axios = require("axios"); // Utiliser axios pour les requêtes HTTP
var app = express();
var cors = require("cors");
app.listen(8889);
app.use(cors()); // Pour permettre le cross origin
app.use(express.json()); // Pour traiter les requêtes JSON
app.use(express.urlencoded({ extended: true })); // Pour traiter les requêtes encodées en URL

// Importation des routes
const userRoutes = require('./routes/userRoutes');
const siteRoutesGet = require('./routes/getSitesRoutes');
const siteRoutesPut = require('./routes/putSitesRoutes');
const menuRoutes = require('./routes/menuRoutes');

async function run() {
  try {
    app.use('/auth', userRoutes);
    app.use('/sites', siteRoutesGet);
    app.use('/sites', siteRoutesPut);
    app.use('/menu', menuRoutes);
  } catch (error) {
    console.error("Error try :" + error);
    pool.end();
  }
}

run().catch(console.dir);
