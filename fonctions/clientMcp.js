// Client du serveur MCP « cenca-sites » (mcp/), utilisé par le chatbot.
// Le MCP reste un service séparé : le backend s'y connecte en HTTP, comme n'importe quel client MCP.

require('dotenv').config();

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const MCP_URL = process.env.MCP_URL || 'http://127.0.0.1:8891/mcp';
const MCP_API_TOKEN = process.env.MCP_API_TOKEN;

// Seules les requêtes métier connues sont proposées au modèle :
// ni SQL libre (executer_requete), ni outils d'exploration du schéma.
const OUTILS_AUTORISES = [
    'rechercher_sites',
    'fiche_site',
    'geometrie_site',
    'sites_autour_point',
    'sites_par_commune',
    'synthese_sites',
    'foncier_site',
    'echeances_actes',
    'rechercher_projets',
    'operations_projet',
    'bilan_operations',
];

const TAILLE_MAX_RESULTAT = 15000; // caractères renvoyés au modèle par appel d'outil
const DUREE_CACHE_MS = 10 * 60 * 1000;

let cacheOutils = { outils: null, date: 0 };
let cacheDocumentation = null;

/**
 * Ouvre une connexion MCP, exécute `traitement(client)` puis ferme la connexion.
 * Le serveur MCP est sans état : une connexion par opération suffit.
 */
async function avecClient(traitement) {
    if (!MCP_API_TOKEN) throw new Error('MCP_API_TOKEN absent du .env du backend');
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: `Bearer ${MCP_API_TOKEN}` } },
    });
    const client = new Client({ name: 'backend-chatbot-cenca', version: '1.0.0' });
    await client.connect(transport);
    try {
        return await traitement(client);
    } finally {
        await client.close().catch(() => {});
    }
}

/**
 * Concatène le texte d'un résultat d'outil MCP.
 */
function texteResultat(resultat) {
    return (resultat.content || [])
        .filter(bloc => bloc.type === 'text')
        .map(bloc => bloc.text)
        .join('\n');
}

/**
 * Outils autorisés, au format attendu par Ollama (tools de /api/chat). Mis en cache.
 */
async function listerOutils() {
    if (cacheOutils.outils && Date.now() - cacheOutils.date < DUREE_CACHE_MS) return cacheOutils.outils;
    const { tools } = await avecClient(client => client.listTools());
    const outils = tools
        .filter(outil => OUTILS_AUTORISES.includes(outil.name))
        .map(outil => ({
            type: 'function',
            function: {
                name: outil.name,
                description: outil.description || outil.title || outil.name,
                parameters: outil.inputSchema || { type: 'object', properties: {} },
            },
        }));
    cacheOutils = { outils, date: Date.now() };
    return outils;
}

/**
 * Appelle un outil autorisé et renvoie son résultat texte (tronqué si trop long).
 */
async function appelerOutil(nom, args = {}) {
    if (!OUTILS_AUTORISES.includes(nom)) {
        throw new Error(`Outil non autorisé : ${nom}`);
    }
    const resultat = await avecClient(client => client.callTool({ name: nom, arguments: args }));
    let texte = texteResultat(resultat);
    if (resultat.isError) texte = `Erreur : ${texte}`;
    if (texte.length > TAILLE_MAX_RESULTAT) {
        texte = texte.slice(0, TAILLE_MAX_RESULTAT)
            + `\n[… résultat tronqué à ${TAILLE_MAX_RESULTAT} caractères : affiner la demande (filtres, limite)]`;
    }
    return texte;
}

/**
 * Guide métier de la base (outil documentation_base), mis en cache pour le prompt système.
 */
async function documentationBase() {
    if (cacheDocumentation) return cacheDocumentation;
    const resultat = await avecClient(client => client.callTool({ name: 'documentation_base', arguments: {} }));
    cacheDocumentation = texteResultat(resultat);
    return cacheDocumentation;
}

module.exports = { OUTILS_AUTORISES, listerOutils, appelerOutil, documentationBase };
