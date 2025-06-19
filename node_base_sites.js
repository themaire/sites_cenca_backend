"use strict";

// Charger les variables d'environnement
require('dotenv').config();

// Utiliser la clé secrète depuis le fichier .env
const NODE_PORT = process.env.NODE_PORT;

var express = require("express");
const client = require('prom-client'); // Pour la surveillance des performances avec Proxmox*
const promBundle = require("express-prom-bundle");
var app = express();

// PAS BESOIN de ce bloc si tu utilises express-prom-bundle :
// const register = new client.Registry();
// client.collectDefaultMetrics({ register });
// app.get('/metrics', async (req, res) => {
//   res.set('Content-Type', register.contentType);
//   res.end(await register.metrics());
// });

const metricsMiddleware = promBundle({
  includeMethod: true,
  includePath: true,
  includeStatusCode: true,
  promClient: {
    collectDefaultMetrics: {},
  },
  customLabels: { project_name: 'node-app-observability', project_type: 'expressjs' },
  normalizePath: [
    // Regroupe les routes dynamiques pour de plus jolis graphs
    ['^/user/.*', '/user/#val'],
    ['^/order/.*', '/order/#val'],
  ],
});
app.use(metricsMiddleware);

var cors = require("cors");
app.listen(NODE_PORT);
app.use(cors()); // Pour permettre le cross origin
app.use(express.json()); // Pour traiter les requêtes JSON
app.use(express.urlencoded({ extended: true })); // Pour traiter les requêtes encodées en URL

// Importation des routes
const menuRoutes = require('./routes/menuRoutes');
const siteRoutesGet = require('./routes/getSitesRoutes');
const siteRoutesPut = require('./routes/putSitesRoutes');
const siteRoutesDelete = require('./routes/deleteSitesRoutes');
const foncierRoutes = require('./routes/foncierRoutes');
const userRoutes = require('./routes/userRoutes');
const processRoutes = require('./routes/processRoutes');

async function run() {
  try {
    app.use('/auth', userRoutes);
    app.use('/sites', siteRoutesGet);
    app.use('/sites', siteRoutesPut);
    app.use('/sites', siteRoutesDelete);
    app.use('/sites', foncierRoutes);
    app.use('/menu', menuRoutes);
    app.use('/process', processRoutes);

    // Middleware pour capturer les routes inconnues
    app.use((req, res, next) => {
      res.status(404).json({
        success: false,
        message: "Route non trouvée.",
        req : req.url
      });
      console.log("Route non trouvée : " + req.url);
    });

    // Middleware pour gérer les erreurs
    app.use((err, req, res, next) => {
      console.error(err.stack);
      res.status(500).json({
        success: false,
        message: "Erreur interne du serveur."
      });
    });

  } catch (error) {
    console.error("Error try :" + error);
    pool.end();
  }
}

run().catch(console.dir);
