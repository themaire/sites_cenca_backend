// Vérification de la validité des liens hypertexte stockés en base
// GET /sites/check-url?url=...  →  { ok: true | false, status }
// ok = true si le code HTTP final est entre 200 et 399.

const express = require("express");
const router = express.Router();

const http = require("http");
const https = require("https");
const dns = require("dns");
const net = require("net");

const { authenticateToken } = require("../../fonctions/fonctionsAuth.js");

const TIMEOUT_MS = 5000; // Timeout global d'une requête (HEAD ou GET)
const MAX_REDIRECTS = 5;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_ENTRIES = 1000;

// ---------------------------------------------------------------------------
// Protection SSRF : plages d'adresses interdites (locales, privées, réservées)
// ---------------------------------------------------------------------------
const blockList = new net.BlockList();
[
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10], // CGNAT
    ["127.0.0.0", 8],
    ["169.254.0.0", 16], // link-local (dont métadonnées cloud 169.254.169.254)
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["224.0.0.0", 4], // multicast
    ["240.0.0.0", 4], // réservé + broadcast
].forEach(([addr, prefix]) => blockList.addSubnet(addr, prefix, "ipv4"));
[
    ["::", 128],
    ["::1", 128],
    ["fc00::", 7], // unique local
    ["fe80::", 10], // link-local
    ["ff00::", 8], // multicast
].forEach(([addr, prefix]) => blockList.addSubnet(addr, prefix, "ipv6"));

function isForbiddenAddress(address) {
    const family = net.isIP(address);
    if (family === 4) return blockList.check(address, "ipv4");
    if (family === 6) {
        // Adresse IPv4 encapsulée (::ffff:127.0.0.1) : tester la partie IPv4
        const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
        if (mapped) return blockList.check(mapped[1], "ipv4");
        return blockList.check(address, "ipv6");
    }
    return true; // Adresse non reconnue : refusée par précaution
}

// Résolution DNS utilisée par http/https : refuse la connexion si une des adresses
// résolues est privée. Vérifié à chaque requête (donc à chaque redirection),
// ce qui protège aussi contre le DNS rebinding.
function safeLookup(hostname, options, callback) {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err);
        const forbidden = addresses.find((a) => isForbiddenAddress(a.address));
        if (forbidden) {
            return callback(new Error("Adresse interdite : " + forbidden.address));
        }
        if (options.all) return callback(null, addresses);
        callback(null, addresses[0].address, addresses[0].family);
    });
}

// Valide le format de l'URL et le protocole. Renvoie un objet URL ou null.
function parseAllowedUrl(rawUrl) {
    let url;
    try {
        url = new URL(rawUrl);
    } catch (e) {
        return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    const host = url.hostname.replace(/^\[|\]$/g, ""); // [::1] → ::1
    if (host === "" || host.toLowerCase() === "localhost" || host.toLowerCase().endsWith(".localhost")) {
        return null;
    }
    // IP littérale : la résolution DNS n'est pas appelée par Node, on vérifie ici
    if (net.isIP(host) && isForbiddenAddress(host)) return null;

    return url;
}

// ---------------------------------------------------------------------------
// "Soft errors" : certains sites répondent HTTP 200 mais affichent une page
// d'erreur (applications Angular/React rendues côté serveur). Pour ces domaines,
// on télécharge la page et on recherche un marqueur d'erreur dans le HTML.
// Ajouter ici d'autres domaines si besoin.
// ---------------------------------------------------------------------------
const SOFT_ERROR_RULES = [
    {
        // INPN (MNHN) : page "Erreur 500 - Une erreur s'est produite lors du chargement de cette page"
        host: "inpn.mnhn.fr",
        pattern: /class="error-title"[^>]*>\s*Erreur\s+\d{3}/i,
    },
];
const MAX_BODY_BYTES = 512 * 1024; // On ne lit pas plus de 512 Ko de HTML

function findSoftErrorRule(url) {
    const host = url.hostname.toLowerCase();
    return SOFT_ERROR_RULES.find((rule) => host === rule.host || host.endsWith("." + rule.host));
}

// ---------------------------------------------------------------------------
// Requête HTTP unitaire (sans suivi des redirections) → { status, location, body }
// body n'est lu que si readBody = true (sinon undefined)
// ---------------------------------------------------------------------------
function requestOnce(url, method, readBody = false) {
    return new Promise((resolve, reject) => {
        const lib = url.protocol === "https:" ? https : http;
        const done = (value) => {
            clearTimeout(timer);
            resolve(value);
            req.destroy();
        };
        const req = lib.request(
            url,
            {
                method,
                lookup: safeLookup,
                headers: {
                    "User-Agent": "Mozilla/5.0 (compatible; CENCA-LinkChecker/1.0)",
                    Accept: "*/*",
                },
            },
            (res) => {
                const result = { status: res.statusCode, location: res.headers.location };
                const isRedirect = res.statusCode >= 300 && res.statusCode < 400;
                if (!readBody || isRedirect) {
                    // On n'a besoin que du code HTTP : on coupe sans lire le corps
                    res.resume();
                    return done(result);
                }
                const chunks = [];
                let size = 0;
                res.on("data", (chunk) => {
                    chunks.push(chunk);
                    size += chunk.length;
                    if (size >= MAX_BODY_BYTES) {
                        done({ ...result, body: Buffer.concat(chunks).toString("utf8") });
                    }
                });
                res.on("end", () => done({ ...result, body: Buffer.concat(chunks).toString("utf8") }));
                res.on("error", (err) => {
                    clearTimeout(timer);
                    reject(err);
                });
            }
        );
        const timer = setTimeout(() => {
            req.destroy(new Error("Timeout"));
        }, TIMEOUT_MS);
        req.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
        req.end();
    });
}

// Suit les redirections (en revalidant chaque destination) → { status, url, body }
async function requestFollowingRedirects(url, method, readBody = false) {
    let current = url;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
        const { status, location, body } = await requestOnce(current, method, readBody);
        if (status >= 300 && status < 400 && location) {
            const next = parseAllowedUrl(new URL(location, current).href);
            if (!next) throw new Error("Redirection vers une adresse interdite");
            current = next;
            continue;
        }
        return { status, url: current, body };
    }
    throw new Error("Trop de redirections");
}

// Renvoie { ok, status } (status = code HTTP final, ou code affiché par la page d'erreur)
async function checkUrl(url) {
    let response = await requestFollowingRedirects(url, "HEAD");
    // Certains serveurs refusent HEAD : on retente en GET
    if (response.status === 405 || response.status === 403) {
        response = await requestFollowingRedirects(url, "GET");
    }
    const ok = response.status >= 200 && response.status < 400;

    // Test supplémentaire pour les domaines à "soft errors" (URL finale, après redirections)
    const rule = ok ? findSoftErrorRule(response.url) : null;
    if (rule) {
        const page = await requestFollowingRedirects(response.url, "GET", true);
        const match = (page.body || "").match(rule.pattern);
        if (match) {
            const shownStatus = parseInt((match[0].match(/\d{3}/) || [])[0], 10);
            return { ok: false, status: shownStatus || page.status };
        }
        return { ok: page.status >= 200 && page.status < 400, status: page.status };
    }

    return { ok, status: response.status };
}

// ---------------------------------------------------------------------------
// Cache mémoire : url → { ok, status, expires }
// ---------------------------------------------------------------------------
const cache = new Map();

function getCached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expires < Date.now()) {
        cache.delete(key);
        return null;
    }
    return entry;
}

function setCached(key, value) {
    if (cache.size >= CACHE_MAX_ENTRIES) {
        cache.delete(cache.keys().next().value); // Supprime l'entrée la plus ancienne
    }
    cache.set(key, { ...value, expires: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------
router.get("/check-url", authenticateToken, async (req, res) => {
    const rawUrl = req.query.url;
    if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
        return res.status(400).json({ ok: false, message: "Paramètre url manquant." });
    }

    const url = parseAllowedUrl(rawUrl.trim());
    if (!url) {
        return res.status(400).json({ ok: false, message: "URL invalide ou non autorisée." });
    }

    const cached = getCached(url.href);
    if (cached) {
        return res.json({ ok: cached.ok, status: cached.status });
    }

    let result;
    try {
        result = await checkUrl(url);
    } catch (error) {
        console.log("[check-url] " + url.href + " : " + error.message);
        result = { ok: false, status: null };
    }

    setCached(url.href, result);
    res.json(result);
});

module.exports = router;
