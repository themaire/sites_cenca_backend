"use strict";

const crypto = require('crypto');

/**
 * Convertit une IPv4 (éventuellement préfixée ::ffff:) en entier, ou null.
 */
function ipv4EnEntier(ip) {
  const brute = ip.replace(/^::ffff:/, '');
  const parties = brute.split('.');
  if (parties.length !== 4 || parties.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return parties.reduce((acc, p) => ((acc << 8) + Number(p)) >>> 0, 0);
}

/**
 * Teste si une IP appartient à une liste de CIDR IPv4 ("192.168.1.0/24", "10.8.0.5", ...).
 * ::1 est accepté si 127.0.0.1 l'est.
 */
function ipAutorisee(ip, plages) {
  if (!ip) return false;
  const adresse = ip === '::1' ? ipv4EnEntier('127.0.0.1') : ipv4EnEntier(ip);
  if (adresse === null) return false;
  return plages.some(plage => {
    const [reseau, bitsTexte] = plage.split('/');
    const base = ipv4EnEntier(reseau);
    if (base === null) return false;
    const bits = bitsTexte === undefined ? 32 : Number(bitsTexte);
    const masque = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((adresse & masque) >>> 0) === ((base & masque) >>> 0);
  });
}

/**
 * Middleware : filtre par IP source (machine locale, réseau local, VPN).
 */
function filtreIp(plages) {
  return (req, res, next) => {
    const ip = req.socket.remoteAddress;
    if (ipAutorisee(ip, plages)) return next();
    console.warn(`[${new Date().toISOString()}] Accès refusé depuis ${ip}`);
    res.status(403).json({ error: 'Adresse IP non autorisée' });
  };
}

/**
 * Middleware : vérifie le jeton "Authorization: Bearer <MCP_API_TOKEN>" (comparaison à temps constant).
 */
function verifierJeton(jetonAttendu) {
  const attendu = Buffer.from(jetonAttendu);
  return (req, res, next) => {
    const recu = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    if (recu.length === attendu.length && crypto.timingSafeEqual(recu, attendu)) return next();
    console.warn(`[${new Date().toISOString()}] Jeton invalide depuis ${req.socket.remoteAddress}`);
    res.status(401).json({ error: 'Jeton invalide ou absent' });
  };
}

module.exports = { ipAutorisee, filtreIp, verifierJeton };
