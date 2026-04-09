"use strict";

// Charger les variables d'environnement
require('dotenv').config();

const https = require('https');
const fs = require('fs');
const path = require('path');

// Utiliser la clé secrète depuis le fichier .env
const NODE_PORT = process.env.NODE_PORT;
const NODE_ENV = process.env.NODE_ENV || 'development'; // Ajouter cette variable

/**
 * Répertoire des fichiers, défini dans le fichier .env ou par défaut dans un dossier 'files' au même niveau que ce script.
 * Assurez-vous que ce répertoire existe et que le serveur a les permissions nécessaires pour y accéder.
 */
const FILES_DIR_ENV = process.env.FILES_DIR_ENV || path.join(__dirname, 'files');

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
const globalRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    if (!res.getHeader('Access-Control-Allow-Origin')) {
      const origin = req.headers.origin;
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    }
    res.status(429).json({
      error: 'Trop de requêtes, veuillez réessayer plus tard.'
    });
  }
});

var cors = require("cors");
// app.listen(NODE_PORT); // ← Déplacé dans la fonction run() pour gestion HTTPS/HTTP

// app.use(cors()); // Pour permettre le cross origin


/**
 * Tableau des origines autorisées pour les requêtes CORS.
 * Seules les requêtes provenant de ces URLs seront acceptées par le serveur.
 *
 * @type {string[]}
 * @const
 */
const allowedOrigins = [
  'https://si-10.cen-champagne-ardenne.org', // HTTPS principal
  'https://si-10.cen-champagne-ardenne.org:444',
  'http://si-10.cen-champagne-ardenne.org', // Gardez HTTP pour la transition
  'http://si-10.cen-champagne-ardenne.org:8889',
  'http://192.168.1.227:4200',
  'http://192.168.1.50:8887',
  'http://localhost:4200',
  'http://localhost:8887',
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

// Appliquer le rate limit apres CORS pour conserver les headers CORS en 429
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const isLocal =
    !origin ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ||
    /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);

  if (isLocal) {
    return next();
  }
  return globalRateLimit(req, res, next);
});


// debugger les requêtes entrantes
// app.use((req, res, next) => {
//   console.log(`Requête reçue : ${req.method} ${req.url}`);
//   console.log('En-têtes :', req.headers);
//   next();
// });


// app.use(cors()); // Middleware CORS
app.options('*', (req, res, next) => {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const isLocal =
    !origin ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ||
    /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);

  if (isLocal) {
    return next();
  }
  return globalRateLimit(req, res, next);
}, cors()); // Répond à toutes les requêtes préflight
app.use(express.json()); // Pour traiter les requêtes JSON
app.use(express.urlencoded({ extended: true })); // Pour traiter les requêtes encodées en URL

// Importation des routes
const menuRoutes = require('./routes/menuRoutes');
const siteRoutesGet = require('./routes/sites/getSitesRoutes.js');
const siteRoutesPut = require('./routes/sites/putSitesRoutes.js');

// Import du middleware d'authentification
const { authenticateToken } = require('./fonctions/fonctionsAuth.js');

const foncierRoutes = require('./routes/sites/foncierRoutes.js');
const siteRoutesDelete = require('./routes/sites/deleteSitesRoutes.js');
const userRoutes = require('./routes/admin/userRoutes.js');
const processRoutes = require('./routes/processRoutes');
const pictureRoute = require('./routes/pictureRoute');
const apiGeoRoutes = require('./routes/apiGeoRoutes');

const adminRoutes = require('./routes/admin/adminRoute.js');

// Configuration HTTPS (seulement en production)
let httpsOptions = null;
if (NODE_ENV === 'production') {
  try {
    httpsOptions = {
      key: fs.readFileSync('/etc/ssl/certs/si-10.cen-champagne-ardenne.org/privkey.pem'),
      cert: fs.readFileSync('/etc/ssl/certs/si-10.cen-champagne-ardenne.org/fullchain.pem')
    };
    console.log('🔒 Certificats HTTPS chargés pour la production');
  } catch (error) {
    console.error('❌ Erreur lors du chargement des certificats HTTPS:', error.message);
    console.log('🔄 Basculement en mode HTTP');
    httpsOptions = null;
  }
}

// Fonction principale pour démarrer le serveur
async function run() {
  try {

    // // récupérer toutes les communes en cache 
    // await getAllCommunesCache(); // Appel de la fonction pour précharger les communes en cache
    // console.log("✅ Cache des communes préchargé");
    // console.log("Global cacheCommunes:", global.communesCache.length); // Affiche le contenu du cache des communes

    app.use('/menu', menuRoutes);
    app.use('/auth', userRoutes);

    app.use('/admin', adminRoutes);

    app.use('/sites', siteRoutesGet);
    app.use('/sites', siteRoutesPut);
    app.use('/sites', siteRoutesDelete);

    app.use('/sites', foncierRoutes);

    app.use('/process', processRoutes);
    app.use('/picts', pictureRoute); // Monté le routeur pictureRoute.js sur /picts
    app.use('/api-geo', apiGeoRoutes); // Routes pour les API géographiques (IGN + Lizmap)

    // Routeur pour la documentation Markdown
    const docsRoutes = require('./routes/docsRoutes');
    app.use('/docs', docsRoutes);

    // Servir les fichiers statiques
    console.log("🗂️  Static files served from:", FILES_DIR_ENV);
    app.use("/files", express.static(FILES_DIR_ENV));

    app.get('/debug/routes', authenticateToken, (req, res) => {
        const routes = [];
        app._router.stack.forEach(middleware => {
            if (middleware.route) {
                routes.push({
                    path: middleware.route.path,
                    method: Object.keys(middleware.route.methods)[0].toUpperCase()
                });
            } else if (middleware.name === 'router') {
                middleware.handle.stack.forEach(handler => {
                    if (handler.route) {
                        const basePath = middleware.regexp.source.replace('\\/?(?=\\/|$)', '').replace('^', '').replace('\\', '');
                        routes.push({
                            path: basePath + handler.route.path,
                            method: Object.keys(handler.route.methods)[0].toUpperCase()
                        });
                    }
                });
            }
        });
        res.json({ routes });
    });

    // Middleware pour capturer les routes inconnues
    app.use((req, res, next) => {
      const clientIp = req.headers['x-forwarded-for'] || req.ip;
      console.log(`Route non trouvée : ${req.url}, IP du client : ${clientIp}`);
      res.status(404).json({
        success: false,
        message: "Route non trouvée.",
        req: req.url,
        ip: clientIp
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

    // Créer le serveur selon l'environnement
    if (httpsOptions && NODE_ENV === 'production') {
      // Mode HTTPS pour la production
      const server = https.createServer(httpsOptions, app);
      server.listen(NODE_PORT, () => {
        console.log(`🔒 Serveur HTTPS démarré sur le port ${NODE_PORT}`);
        console.log(`🚀 Backend accessible via https://si-10.cen-champagne-ardenne.org:${NODE_PORT}`);
      });
    } else {
      // Mode HTTP pour le développement
      app.listen(NODE_PORT, () => {
        console.log(`🔓 Serveur HTTP démarré sur le port ${NODE_PORT}`);
        console.log(`🚀 Backend accessible via http://192.168.1.50:${NODE_PORT} ou http://IP:${NODE_PORT}`);
        console.log(`📝 Mode: ${NODE_ENV}`);
      });
    }

    process.on('SIGTERM', async () => {
    console.log('🛑 Signal SIGTERM reçu, arrêt du serveur...');
    // Fermer proprement la connexion à la base si elle existe
    if (typeof pool !== 'undefined' && pool.end) {
      try {
        await pool.end();
        console.log('✅ Connexion à la base fermée');
      } catch (err) {
        console.error('Erreur lors de la fermeture de la base :', err);
      }
    }
    // Arrêter le serveur Express si besoin
    if (typeof server !== 'undefined' && server.close) {
      server.close(() => {
        console.log('✅ Serveur Express arrêté');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });

  } catch (error) {
    console.error("Error try :" + error);
    // pool.end(); // Décommentez si vous avez une variable pool
  }
}

run().catch(console.dir);
