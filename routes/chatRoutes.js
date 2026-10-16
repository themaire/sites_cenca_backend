// Chatbot métier : un LLM local (Ollama) répond aux questions sur les sites
// en n'utilisant que les requêtes métier connues du serveur MCP (lecture seule).
//
// POST /chat  { messages: [{ role: 'user' | 'assistant', content }] }
// Réponse en flux SSE (text/event-stream) :
//   event: outil   data: { nom, arguments }   -> requête métier lancée (transparence)
//   event: texte   data: { texte }            -> morceau de la réponse
//   event: fin     data: { outils, duree_ms }
//   event: erreur  data: { message }

require('dotenv').config();

const express = require('express');
const rateLimit = require('express-rate-limit');
const { Ollama } = require('ollama');

const { authenticateToken } = require('../fonctions/fonctionsAuth.js');
const { listerOutils, appelerOutil, documentationBase } = require('../fonctions/clientMcp.js');

const router = express.Router();

// Un ou plusieurs serveurs Ollama du LAN, séparés par des virgules : le premier joignable est utilisé
const OLLAMA_URLS = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434')
    .split(',').map(s => s.trim()).filter(Boolean);
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4';
const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX || 32768);

const TOURS_OUTILS_MAX = 8;       // appels au modèle avec outils avant de forcer une réponse
const MESSAGES_MAX = 20;          // historique conservé (le front porte la conversation)
const LONGUEUR_MESSAGE_MAX = 4000;

const clientsOllama = OLLAMA_URLS.map(host => ({ host, client: new Ollama({ host }) }));

/**
 * Premier serveur Ollama qui répond (GET /api/version, 2 s max), ou null.
 */
async function serveurOllamaDisponible() {
    for (const serveur of clientsOllama) {
        try {
            const reponse = await fetch(`${serveur.host}/api/version`, { signal: AbortSignal.timeout(2000) });
            if (reponse.ok) return serveur;
        } catch {
            console.warn(`[chat] Ollama injoignable : ${serveur.host}`);
        }
    }
    return null;
}

// Le LLM est coûteux en calcul : limite propre au chat, par utilisateur
const chatRateLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.tokenInfos?.identifiant || 'inconnu',
    message: { message: 'Trop de questions au chatbot, réessayez dans quelques minutes.' },
});

/**
 * Prompt système : rôle, règles, puis guide métier de la base (servi par le MCP).
 */
async function promptSysteme() {
    const documentation = await documentationBase();
    const aujourdhui = new Date().toISOString().slice(0, 10);
    return [
        "Tu es l'assistant de l'application des sites du Conservatoire d'espaces naturels de Champagne-Ardenne (CENCA).",
        `Date du jour : ${aujourdhui}.`,
        "Règles :",
        "- Réponds toujours en français, de façon concise, en Markdown (listes, tableaux courts).",
        "- Tes seules sources de données sont les outils fournis (requêtes métier en lecture seule). Appelle-les pour chaque question portant sur les données ; tu peux en enchaîner plusieurs.",
        "- N'invente jamais de chiffre, de site, de code ou de date : tout doit venir d'un résultat d'outil. Si un résultat est vide ou tronqué, dis-le.",
        "- Si aucun outil ne permet de répondre, explique-le simplement et propose une question voisine à laquelle tu peux répondre.",
        "- Les codes de site ressemblent à 51BOIS01 ; si l'utilisateur donne un nom, cherche d'abord le site avec rechercher_sites.",
        "- Les surfaces sont en hectares sauf mention contraire ; précise l'unité.",
        "",
        "Guide métier de la base (pour comprendre les résultats des outils) :",
        documentation,
    ].join('\n');
}

/**
 * Nettoie l'historique envoyé par le client : rôles user/assistant uniquement, tailles bornées.
 */
function historiqueValide(messages) {
    if (!Array.isArray(messages)) return null;
    const propres = messages
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .slice(-MESSAGES_MAX)
        .map(m => ({ role: m.role, content: m.content.slice(0, LONGUEUR_MESSAGE_MAX) }));
    if (propres.length === 0 || propres[propres.length - 1].role !== 'user') return null;
    return propres;
}

/**
 * Message d'erreur lisible pour l'utilisateur.
 */
function messageErreur(err, etape) {
    const code = err?.cause?.code || err?.code;
    if (etape === 'mcp') return "Le serveur de requêtes métier (MCP) est injoignable.";
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || /fetch failed/i.test(err?.message)) {
        return 'Aucun serveur Ollama n\'est joignable.';
    }
    if (err?.status_code === 404 || /not found/i.test(err?.message)) {
        return `Le modèle « ${OLLAMA_MODEL} » est introuvable sur le serveur Ollama.`;
    }
    return 'Erreur du chatbot : ' + (err?.message || err);
}

router.post('/', authenticateToken, chatRateLimit, async (req, res) => {
    const historique = historiqueValide(req.body?.messages);
    if (!historique) {
        return res.status(400).json({ message: 'Paramètre "messages" invalide : le dernier message doit venir de l\'utilisateur.' });
    }

    const debut = Date.now();
    const identifiant = req.tokenInfos?.identifiant;
    const outilsAppeles = [];
    let interrompu = false;
    let fluxEnCours = null;

    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const envoyer = (evenement, donnees) => {
        if (!interrompu) res.write(`event: ${evenement}\ndata: ${JSON.stringify(donnees)}\n\n`);
    };

    // L'utilisateur a fermé le panneau ou quitté la page : on arrête le modèle
    res.on('close', () => {
        if (!res.writableEnded) {
            interrompu = true;
            if (fluxEnCours) fluxEnCours.abort();
        }
    });

    let etape = 'mcp';
    try {
        const [outils, systeme] = await Promise.all([listerOutils(), promptSysteme()]);
        etape = 'ollama';

        const serveur = await serveurOllamaDisponible();
        if (!serveur) throw Object.assign(new Error('aucun serveur Ollama joignable'), { code: 'ECONNREFUSED' });
        const ollama = serveur.client;

        const messages = [{ role: 'system', content: systeme }, ...historique];

        for (let tour = 0; tour <= TOURS_OUTILS_MAX && !interrompu; tour++) {
            // Dernier tour : plus d'outils, le modèle doit conclure avec ce qu'il a
            const avecOutils = tour < TOURS_OUTILS_MAX;
            fluxEnCours = await ollama.chat({
                model: OLLAMA_MODEL,
                messages,
                tools: avecOutils ? outils : undefined,
                stream: true,
                options: { num_ctx: OLLAMA_NUM_CTX },
            });

            let contenu = '';
            const appels = [];
            for await (const morceau of fluxEnCours) {
                const message = morceau.message || {};
                if (message.content) {
                    contenu += message.content;
                    envoyer('texte', { texte: message.content });
                }
                if (message.tool_calls?.length) appels.push(...message.tool_calls);
            }
            fluxEnCours = null;

            if (appels.length === 0 || !avecOutils) break;

            messages.push({ role: 'assistant', content: contenu, tool_calls: appels });
            for (const appel of appels) {
                if (interrompu) break;
                const nom = appel.function?.name;
                let args = appel.function?.arguments || {};
                if (typeof args === 'string') {
                    try { args = JSON.parse(args); } catch { args = {}; }
                }
                outilsAppeles.push(nom);
                envoyer('outil', { nom, arguments: args });

                let resultat;
                try {
                    resultat = await appelerOutil(nom, args);
                } catch (err) {
                    resultat = `Erreur : ${err.message}`;
                }
                messages.push({ role: 'tool', tool_name: nom, content: resultat });
            }
        }

        envoyer('fin', { outils: outilsAppeles, duree_ms: Date.now() - debut });
    } catch (err) {
        if (!interrompu) {
            console.error(`Erreur chatbot (${etape}) :`, err);
            envoyer('erreur', { message: messageErreur(err, etape) });
        }
    } finally {
        console.log(`[chat] ${identifiant} (${OLLAMA_MODEL}) : ${outilsAppeles.length} outil(s) [${outilsAppeles.join(', ')}] en ${Date.now() - debut} ms${interrompu ? ' (interrompu)' : ''}`);
        if (!interrompu) res.end();
    }
});

module.exports = router;
