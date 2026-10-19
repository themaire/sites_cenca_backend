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

// Serveurs Ollama du LAN, par ordre de préférence, séparés par des virgules.
// Modèle propre à un serveur possible avec « | » : http://pi5:11434|gemma4:e2b (sinon OLLAMA_MODEL).
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4';
const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX || 32768);
// Raisonnement préalable des modèles « thinking » : ignoré par le flux envoyé au front, coûteux sur CPU
const OLLAMA_THINK = process.env.OLLAMA_THINK === 'true';

const TOURS_OUTILS_MAX = 8;       // appels au modèle avec outils avant de forcer une réponse
const MESSAGES_MAX = 20;          // historique conservé (le front porte la conversation)
const LONGUEUR_MESSAGE_MAX = 4000;

const serveursOllama = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map((entree, rang) => {
        const [host, modele] = entree.split('|').map(s => s.trim());
        return { rang, host, modele: modele || OLLAMA_MODEL, client: new Ollama({ host }), enCours: 0 };
    });

/**
 * Choisit le serveur Ollama le moins occupé parmi ceux qui répondent (GET /api/version, 2 s max).
 * « Occupé » = nombre de conversations que ce backend y fait tourner en ce moment ;
 * à charge égale, l'ordre de OLLAMA_URL décide (serveur principal d'abord).
 * Le serveur choisi est réservé (enCours + 1) : l'appelant doit appeler liberer() à la fin.
 * Renvoie null si aucun serveur ne répond.
 */
async function choisirServeurOllama() {
    const candidats = [...serveursOllama].sort((a, b) => a.enCours - b.enCours || a.rang - b.rang);
    for (const serveur of candidats) {
        // Réservé avant le test : deux questions simultanées ne visent pas le même serveur
        serveur.enCours++;
        try {
            const reponse = await fetch(`${serveur.host}/api/version`, { signal: AbortSignal.timeout(2000) });
            if (reponse.ok) return serveur;
        } catch {
            console.warn(`[chat] Ollama injoignable : ${serveur.host}`);
        }
        serveur.enCours--;
    }
    return null;
}

function liberer(serveur) {
    if (serveur) serveur.enCours = Math.max(0, serveur.enCours - 1);
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
        "- Appelle l'outil adapté directement, sans demander la permission ni annoncer ce que tu vas faire.",
        "- Passe aux outils les noms (communes, sites) tels que l'utilisateur les a écrits. N'invente jamais de code INSEE ni de code de site : n'utilise un code que s'il vient de l'utilisateur ou d'un résultat d'outil.",
        "- Si un outil ne renvoie aucune ligne, réessaie autrement (nom partiel, autre outil) avant de conclure qu'il n'y a rien.",
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
function messageErreur(err, etape, serveur) {
    const code = err?.cause?.code || err?.code;
    if (etape === 'mcp') return "Le serveur de requêtes métier (MCP) est injoignable.";
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || /fetch failed/i.test(err?.message)) {
        return 'Aucun serveur Ollama n\'est joignable.';
    }
    if (err?.status_code === 404 || /not found/i.test(err?.message)) {
        return `Le modèle « ${serveur?.modele || OLLAMA_MODEL} » est introuvable sur le serveur Ollama ${serveur?.host || ''}.`;
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
    let relance = false;      // relance déjà faite après une réponse vide
    let reponseVide = false;

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
    let serveur = null;
    try {
        const [outils, systeme] = await Promise.all([listerOutils(), promptSysteme()]);
        etape = 'ollama';

        // Toute la conversation (tous les tours d'outils) reste sur le même serveur
        serveur = await choisirServeurOllama();
        if (!serveur) throw Object.assign(new Error('aucun serveur Ollama joignable'), { code: 'ECONNREFUSED' });
        const ollama = serveur.client;

        const messages = [{ role: 'system', content: systeme }, ...historique];

        for (let tour = 0; tour <= TOURS_OUTILS_MAX && !interrompu; tour++) {
            // Dernier tour : plus d'outils, le modèle doit conclure avec ce qu'il a
            const avecOutils = tour < TOURS_OUTILS_MAX;
            fluxEnCours = await ollama.chat({
                model: serveur.modele,
                messages,
                tools: avecOutils ? outils : undefined,
                stream: true,
                think: OLLAMA_THINK,
                options: { num_ctx: OLLAMA_NUM_CTX },
            });

            let contenu = '';
            let raisonnement = 0;
            let raisonFin;
            const appels = [];
            for await (const morceau of fluxEnCours) {
                const message = morceau.message || {};
                if (message.content) {
                    contenu += message.content;
                    envoyer('texte', { texte: message.content });
                }
                if (message.thinking) raisonnement += message.thinking.length;
                if (message.tool_calls?.length) appels.push(...message.tool_calls);
                if (morceau.done) raisonFin = morceau.done_reason;
            }
            fluxEnCours = null;

            if (appels.length === 0 || !avecOutils) {
                // Les petits modèles terminent parfois sans rien écrire après un résultat d'outil :
                // une relance explicite, une seule fois, avant de signaler l'échec au front.
                if (!contenu.trim() && outilsAppeles.length > 0 && !interrompu) {
                    const relancer = !relance && avecOutils;
                    console.warn(`[chat] ${identifiant} : réponse vide au tour ${tour} (done_reason=${raisonFin}, raisonnement=${raisonnement} car.)${relancer ? ', relance' : ''}`);
                    if (relancer) {
                        relance = true;
                        messages.push({ role: 'user', content: 'Rédige maintenant ta réponse à ma question à partir des résultats des outils ci-dessus.' });
                        continue;
                    }
                    reponseVide = true;
                }
                break;
            }

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

        if (reponseVide) {
            envoyer('erreur', { message: "Le modèle n'a pas formulé de réponse à partir des données. Reformulez la question ou réessayez." });
        } else {
            envoyer('fin', { outils: outilsAppeles, duree_ms: Date.now() - debut, modele: serveur.modele });
        }
    } catch (err) {
        if (!interrompu) {
            console.error(`Erreur chatbot (${etape}) :`, err);
            envoyer('erreur', { message: messageErreur(err, etape, serveur) });
        }
    } finally {
        liberer(serveur);
        console.log(`[chat] ${identifiant} (${serveur ? `${serveur.modele} @ ${serveur.host}` : 'aucun serveur'}) : ${outilsAppeles.length} outil(s) [${outilsAppeles.join(', ')}] en ${Date.now() - debut} ms${interrompu ? ' (interrompu)' : ''}`);
        if (!interrompu) res.end();
    }
});

module.exports = router;
