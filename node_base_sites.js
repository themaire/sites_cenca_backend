"use strict";

// Charger les variables d'environnement
require('dotenv').config();

// Utiliser la clé secrète depuis le fichier .env
const NODE_PORT = process.env.NODE_PORT;

var express = require("express");
// const client = require('prom-client'); // Pour la surveillance des performances avec Proxmox*http_request_duration_seconds_count{method="GET", path="/sites", status_code="200", client_ip="192.168.1.100", project_name="node-app-observability", project_type="expressjs"} 1
var app = express();

// PAS BESOIN de ce bloc si tu utilises express-prom-bundle :
// const register = new client.Registry();
// client.collectDefaultMetrics({ register });
// app.get('/metrics', async (req, res) => {
//   res.set('Content-Type', register.contentType);
//   res.end(await register.metrics());
// });

const promBundle = require("express-prom-bundle");

const metricsMiddleware = promBundle({
  includeMethod: true,
  includePath: true,
  includeStatusCode: true,
  promClient: {
    collectDefaultMetrics: {},
  },
  customLabels: {
    project_name: 'node-app-observability',
    project_type: 'expressjs',
    client_ip: null, // Ajout du label personnalisé pour l'IP
  },
  normalizePath: [
    ['^/user/.*', '/user/#val'],
    ['^/order/.*', '/order/#val'],
  ],
  transformLabels: (labels, req) => {
    // Ajoute l'adresse IP du client dans les labels
    labels.client_ip = req.headers['x-forwarded-for'] || req.ip;
    return labels;
  },
});

app.use(metricsMiddleware);

const rateLimit = require("express-rate-limit");

// Configuration du middleware de rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limite chaque IP à 500 requêtes par fenêtre
  message: "Trop de requêtes effectuées depuis cette IP, veuillez réessayer plus tard.",
  standardHeaders: true, // Retourne les informations de rate limit dans les headers `RateLimit-*`
  legacyHeaders: false, // Désactive les headers `X-RateLimit-*`
});

// Appliquer le middleware globalement
app.use(limiter);

var cors = require("cors");
app.listen(NODE_PORT);

// app.use(cors()); // Pour permettre le cross origin


/**
 * Tableau des origines autorisées pour les requêtes CORS.
 * Seules les requêtes provenant de ces URLs seront acceptées par le serveur.
 *
 * @type {string[]}
 * @const
 */
const allowedOrigins = [
  'http://si-10.cen-champagne-ardenne.org',
  'https://si-10.cen-champagne-ardenne.org',
  'http://si-10.cen-champagne-ardenne.org:8070', // Ajout de l'origine avec le port
  'http://si-10.cen-champagne-ardenne.org:8889', // Origine du backend
  'http://192.168.1.227:4200', // Ajout de l'origine avec le port
  'http://192.168.1.50:8887', // Origine du backend
  'http://localhost:4200', // Ajout de l'origine avec le port
  'http://localhost:8887', // Origine du backend
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Origine non autorisée'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Méthodes autorisées
  allowedHeaders: ['Content-Type', 'Authorization'], // En-têtes autorisés
  credentials: true, // Autorise les cookies et les informations d'authentification
}));


// debugger les requêtes entrantes
app.use((req, res, next) => {
  console.log(`Requête reçue : ${req.method} ${req.url}`);
  console.log('En-têtes :', req.headers);
  next();
});


// app.use(cors()); // Middleware CORS
app.options('*', cors()); // Répond à toutes les requêtes préflight
app.use(express.json()); // Pour traiter les requêtes JSON
app.use(express.urlencoded({ extended: true })); // Pour traiter les requêtes encodées en URL

// Importation des routes
const menuRoutes = require('./routes/menuRoutes');
const siteRoutesGet = require('./routes/getSitesRoutes');
const siteRoutesPut = require('./routes/putSitesRoutes');
const foncierRoutes = require('./routes/foncierRoutes');
const siteRoutesDelete = require('./routes/deleteSitesRoutes');
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
    app.use('/sites', foncierRoutes);
    app.use('/process', processRoutes);

    // Middleware pour capturer les routes inconnues
    app.use((req, res, next) => {
      const clientIp = req.headers['x-forwarded-for'] || req.ip; // Récupère l'IP du client
      console.log(`Route non trouvée : ${req.url}, IP du client : ${clientIp}`);
      res.status(404).json({
        success: false,
        message: "Route non trouvée.",
        req: req.url,
        ip: clientIp // Ajoute l'IP dans la réponse JSON
      });
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
