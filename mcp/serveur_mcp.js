"use strict";

// Charger les variables d'environnement (mcp/.env, distinct du .env du backend)
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const { pool, testerConnexion } = require('./dbPool');
const { poolWebobs, testerConnexionWebobs } = require('./dbPoolWebobs');
const { enregistrerOutils } = require('./fonctions/outilsMcp');
const { initialiser } = require('./fonctions/securiteSql');
const { filtreIp, verifierJeton } = require('./fonctions/securiteReseau');

const MCP_HOST = process.env.MCP_HOST || '127.0.0.1';
const MCP_PORT = Number(process.env.MCP_PORT || 8891);
const MCP_API_TOKEN = process.env.MCP_API_TOKEN;
const ALLOWED_IPS = (process.env.ALLOWED_IPS || '127.0.0.1')
  .split(',').map(s => s.trim()).filter(Boolean);

if (!MCP_API_TOKEN || MCP_API_TOKEN.length < 32) {
  console.error('MCP_API_TOKEN absent ou trop court (32 caractères minimum). Générer : openssl rand -hex 32');
  process.exit(1);
}

/**
 * Crée une instance MCP neuve. Mode "stateless" : une instance par requête HTTP,
 * aucune session à conserver côté serveur, robuste aux redémarrages.
 */
function creerServeurMcp() {
  const server = new McpServer(
    { name: 'cenca-sites', version: '1.0.0' },
    {
      instructions: [
        "Accès en LECTURE SEULE à la base PostgreSQL/PostGIS des sites gérés par le CEN Champagne-Ardenne (sites, espaces, maîtrise foncière, documents de gestion, travaux, annuaire).",
        "Appeler documentation_base au début de chaque conversation : elle explique les schémas, les jointures (souvent non déclarées) et les pièges.",
        "Préférer les outils prédéfinis (rechercher_sites, fiche_site, foncier_site, echeances_actes, rechercher_projets, operations_projet, bilan_operations, sites_autour_point…), qui reprennent les requêtes de l'application ; sinon executer_requete.",
        "Géométries en Lambert 93 (SRID 2154, mètres). Faire les agrégations en SQL. Ne jamais inventer de chiffres : toujours citer la requête ou l'outil source.",
        "Observations naturalistes (faune, flore) : outils webobs_* sur la base WebObs, distincte (pas accessible par executer_requete) ; webobs_site et webobs_sites_cenca les croisent avec les emprises des sites.",
      ].join(' '),
    },
  );
  enregistrerOutils(server);
  return server;
}

const app = express();
app.disable('x-powered-by');

// Journal d'accès : chaque requête reçue, même refusée (diagnostic des connexions clients)
app.use((req, res, next) => {
  res.on('finish', () => {
    const methode = req.body?.method ? ` ${req.body.method}` : '';
    console.log(`[${new Date().toISOString()}] ${req.socket.remoteAddress} ${req.method} ${req.path}${methode} -> ${res.statusCode}`);
  });
  next();
});

// Santé (sans jeton, mais filtré par IP)
app.get('/health', filtreIp(ALLOWED_IPS), async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch (e) {
    res.status(503).json({ status: 'ko', db: e.code || 'erreur' });
  }
});

app.use('/mcp', filtreIp(ALLOWED_IPS), verifierJeton(MCP_API_TOKEN), express.json({ limit: '1mb' }));

app.post('/mcp', async (req, res) => {
  const server = creerServeurMcp();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('Erreur MCP :', e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erreur interne' }, id: null });
    }
  }
});

// En mode stateless, pas de flux SSE ni de session à fermer
const nonSupporte = (req, res) => res.status(405).json({
  jsonrpc: '2.0', error: { code: -32000, message: 'Méthode non autorisée' }, id: null,
});
app.get('/mcp', nonSupporte);
app.delete('/mcp', nonSupporte);

testerConnexion()
  .then(() => initialiser(pool))
  .then(colonnes => console.log(`Colonnes sensibles masquées : ${colonnes.length} (${colonnes.slice(0, 10).join(', ')}${colonnes.length > 10 ? '…' : ''})`))
  .catch(e => {
    if (e.critique) {
      console.error(e.message);
      process.exit(1);
    }
    console.error('Attention, base PostgreSQL injoignable au démarrage :', e.message);
  })
  .then(() => testerConnexionWebobs())
  .catch(e => {
    if (e.critique) {
      console.error(e.message);
      process.exit(1);
    }
    console.error('Attention, base WebObs injoignable au démarrage :', e.message);
  })
  .finally(() => {
    app.listen(MCP_PORT, MCP_HOST, () => {
      console.log(`Serveur MCP "cenca-sites" : http://${MCP_HOST}:${MCP_PORT}/mcp`);
      console.log(`IP autorisées : ${ALLOWED_IPS.join(', ')}`);
    });
  });

process.on('SIGTERM', async () => {
  await pool.end().catch(() => {});
  await poolWebobs?.end().catch(() => {});
  process.exit(0);
});
