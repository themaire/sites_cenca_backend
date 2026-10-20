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
    'indicateurs_sites',
    'indicateurs_activite',
    'controle_donnees_sites',
    'webobs_statistiques',
    'webobs_especes',
    'webobs_site',
    'webobs_sites_cenca',
];

const TAILLE_MAX_RESULTAT = 15000; // caractères renvoyés au modèle par appel d'outil
const DUREE_CACHE_MS = 10 * 60 * 1000;

let cacheOutils = { outils: null, date: 0 };

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
 * Concatène le texte d'un résultat d'outil MCP. Si `sites` (Map) est fourni, y range la cible de lien de
 * chaque site du résultat (code, ou uuid_site s'il n'a pas de code ; clés : code et uuid_site en majuscules) :
 * seuls ces sites deviennent des liens.
 */
function texteResultat(resultat, sites) {
    return (resultat.content || [])
        .filter(bloc => bloc.type === 'text')
        .map(bloc => {
            if (sites) relever(bloc.text, sites);
            return compacter(bloc.text);
        })
        .join('\n');
}

// Parcourt le JSON d'un résultat et relève chaque objet portant uuid_site et code (ou code_site)
function relever(texte, sites) {
    let donnees;
    try { donnees = JSON.parse(texte); } catch { return; }
    const parcourir = valeur => {
        if (Array.isArray(valeur)) return valeur.forEach(parcourir);
        if (!valeur || typeof valeur !== 'object') return;
        const code = valeur.code ?? valeur.code_site;
        if (valeur.uuid_site) {
            const cible = code || valeur.uuid_site;
            sites.set(String(valeur.uuid_site).toUpperCase(), cible);
            if (code) sites.set(String(code).toUpperCase(), cible);
        }
        Object.values(valeur).forEach(parcourir);
    };
    parcourir(donnees);
}

// Liste non vide d'objets « plats » (valeurs simples) : se présente en tableau
function estTableau(valeur) {
    return Array.isArray(valeur) && valeur.length > 0 && valeur.every(ligne =>
        ligne && typeof ligne === 'object' && !Array.isArray(ligne)
        && Object.values(ligne).every(v => v === null || typeof v !== 'object'));
}

// Colonnes techniques inutiles au modèle (le MCP reste complet pour les autres clients)
const COLONNES_MASQUEES = new Set(['insee', 'bassin_agence', 'alerte_fin', 'validite']);
const LIGNES_MAX_MODELE = 30;   // au-delà, le modèle reçoit le total exact et les premières lignes
const LIGNES_REPARTITION = 10;  // au-delà, une répartition calculée sur toutes les lignes est jointe

const DEPARTEMENTS = { '08': 'Ardennes', '10': 'Aube', '51': 'Marne', '52': 'Haute-Marne' };

const vide = v => v === null || v === undefined || v === '';

/**
 * Répartition exacte d'une longue liste (département, type, statut, surface totale), calculée ici sur toutes
 * les lignes : le modèle n'en voit qu'une partie et compte mal. Il s'en sert pour résumer au lieu de tout lister.
 */
function repartition(lignes) {
    const compter = valeurDe => {
        const comptes = new Map();
        for (const ligne of lignes) {
            const valeur = valeurDe(ligne);
            if (!vide(valeur)) comptes.set(valeur, (comptes.get(valeur) || 0) + 1);
        }
        return [...comptes].sort((a, b) => b[1] - a[1]).map(([valeur, nb]) => `${valeur} ${nb}`).join(', ');
    };
    const departement = ligne => {
        const code = String(ligne.code ?? ligne.code_site ?? '');
        const numero = /^\d{2}/.test(code) ? code.slice(0, 2) : String(ligne.insee ?? '').slice(0, 2);
        return DEPARTEMENTS[numero] ? `${numero} ${DEPARTEMENTS[numero]}` : null;
    };
    const champType = ['typ_site_txt', 'typ_site_libelle', 'typ_mfu', 'typ_projet', 'action_2_libelle'].find(c => lignes.some(l => !vide(l[c])));
    const parties = [
        ['département', compter(departement)],
        ['type', champType ? compter(l => l[champType]) : ''],
        ['statut', lignes.some(l => !vide(l.statut)) ? compter(l => l.statut) : ''],
    ].filter(([, texte]) => texte).map(([nom, texte]) => `par ${nom} : ${texte}`);
    if (lignes.some(l => !vide(l.surface_ha))) {
        const total = lignes.reduce((somme, l) => somme + (Number(l.surface_ha) || 0), 0);
        parties.push(`surface totale : ${total.toFixed(2)} ha`);
    }
    return parties.length ? `[Répartition exacte des ${lignes.length} lignes, ${parties.join(' ; ')}]` : '';
}

function tableau(lignes) {
    let colonnes = [...new Set(lignes.flatMap(ligne => Object.keys(ligne)))];
    colonnes = colonnes.filter(c =>
        !COLONNES_MASQUEES.has(c)
        // Code brut doublé d'un libellé (typ_site / typ_site_txt) : le libellé suffit
        && !(colonnes.includes(`${c}_txt`) || colonnes.includes(`${c}_libelle`))
        // uuid_site seulement pour les sites sans code (les outils de site acceptent le code)
        && !(c === 'uuid_site' && lignes.every(l => !vide(l.code ?? l.code_site)))
        && lignes.some(l => !vide(l[c])));
    const cellule = (ligne, c) => {
        if (c === 'uuid_site' && !vide(ligne.code ?? ligne.code_site)) return '';
        return vide(ligne[c]) ? '' : String(ligne[c]).replace(/[\t\r\n]+/g, ' ');
    };
    const affichees = lignes.slice(0, LIGNES_MAX_MODELE);
    const texte = [colonnes.join('\t'), ...affichees.map(ligne => colonnes.map(c => cellule(ligne, c)).join('\t'))].join('\n');
    const fin = [
        lignes.length > affichees.length ? `[… ${affichees.length} lignes affichées sur ${lignes.length} : le total exact est ${lignes.length}]` : '',
        lignes.length > LIGNES_REPARTITION ? repartition(lignes) : '',
    ].filter(Boolean);
    return [texte, ...fin].join('\n');
}

/**
 * Résultat JSON du MCP → texte compact pour le modèle : les listes de lignes deviennent des tableaux
 * (colonnes séparées par des tabulations, noms de colonnes une seule fois). Sur CPU, chaque jeton
 * lu coûte. Colonnes techniques retirées et lignes plafonnées (LIGNES_MAX_MODELE, total annoncé).
 */
function compacter(texte) {
    let donnees;
    try { donnees = JSON.parse(texte); } catch { return texte; }
    if (!donnees || typeof donnees !== 'object' || Array.isArray(donnees)) {
        return estTableau(donnees) ? tableau(donnees) : JSON.stringify(donnees);
    }
    return Object.entries(donnees).map(([cle, valeur]) => {
        if (estTableau(valeur)) return `${cle} (tableau, colonnes séparées par des tabulations) :\n${tableau(valeur)}`;
        return `${cle} : ${valeur !== null && typeof valeur === 'object' ? JSON.stringify(valeur) : valeur}`;
    }).join('\n');
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
 * `sites` (Map, optionnelle) reçoit les correspondances code / uuid → cible de lien des sites du résultat.
 */
async function appelerOutil(nom, args = {}, sites) {
    if (!OUTILS_AUTORISES.includes(nom)) {
        throw new Error(`Outil non autorisé : ${nom}`);
    }
    // Les petits modèles envoient null ou "" pour un paramètre non utilisé : le MCP les refuserait
    const argumentsUtiles = Object.fromEntries(
        Object.entries(args || {}).filter(([, valeur]) => valeur !== null && valeur !== undefined && valeur !== '')
    );
    const resultat = await avecClient(client => client.callTool({ name: nom, arguments: argumentsUtiles }));
    let texte = texteResultat(resultat, sites);
    if (resultat.isError) texte = `Erreur : ${texte}`;
    if (texte.length > TAILLE_MAX_RESULTAT) {
        texte = texte.slice(0, TAILLE_MAX_RESULTAT)
            + `\n[… résultat tronqué à ${TAILLE_MAX_RESULTAT} caractères : affiner la demande (filtres, limite)]`;
    }
    return texte;
}

module.exports = { OUTILS_AUTORISES, listerOutils, appelerOutil };
