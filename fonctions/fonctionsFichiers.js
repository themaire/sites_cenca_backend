// Nommage des fichiers déposés (files.docs) et de leurs vignettes en cache.
// Ce module est partagé entre l'upload (putSitesRoutes.js), le redimensionnement
// (pictureRoute.js) et la suppression (deleteSitesRoutes.js) : les trois doivent
// calculer exactement les mêmes noms.

const fs = require("fs");
const path = require("path");

const pool = require("../dbPool/poolConnect.js");

// files.libelles_nom.libnom_id
const LIBNOM_TRAVAUX = 3;

const MAX_NOM_ORIGINAL = 60;

/**
 * Rend un texte utilisable dans un nom de fichier / une URL.
 * "Milieu - Entretenir (été)" -> "Milieu-Entretenir-ete"
 */
function slugifier(texte) {
    return String(texte ?? "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "") // accents
        .replace(/[^A-Za-z0-9_-]+/g, "-") // espaces, apostrophes, #, %, ...
        .replace(/-{2,}/g, "-")
        .replace(/^[-_]+|[-_]+$/g, "");
}

/**
 * Nettoie le nom d'origine d'un fichier pour l'utiliser dans un nom de fichier / une URL.
 * "Compte rendu réunion (v2).PDF" -> { nom: "Compte-rendu-reunion-v2", ext: ".pdf" }
 * @param {string} originalname - file.originalname reçu par multer
 */
function nettoyerNomOriginal(originalname) {
    // multer (busboy) décode le nom en latin1 : on le relit en UTF-8 pour récupérer les accents
    const utf8 = Buffer.from(originalname, "latin1").toString("utf8");
    const nomRecu = utf8.includes("�") ? originalname : utf8;

    const ext = path.extname(nomRecu).toLowerCase();
    const nom = slugifier(path.basename(nomRecu, path.extname(nomRecu)))
        .slice(0, MAX_NOM_ORIGINAL)
        .replace(/[-_]+$/, "");

    return { nom: nom || "fichier", ext };
}

/** Date du jour au format AA-MM-JJ (ex : 26-10-08) */
function dateCourte(date = new Date()) {
    const aa = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const jj = String(date.getDate()).padStart(2, "0");
    return `${aa}-${mm}-${jj}`;
}

/** Code du site d'un projet de travaux (opegerer.projets -> sitcenca.sites), ou "sans-site" */
async function codeSiteDuProjet(uuidProj) {
    const { rows } = await pool.query(
        `SELECT s.code
         FROM opegerer.projets p
         JOIN sitcenca.sites s ON s.uuid_site = p.site
         WHERE p.uuid_proj = $1`,
        [uuidProj]
    );
    return rows[0]?.code || "sans-site";
}

/**
 * Construit le nom d'un document déposé, selon son type (libnom_id) :
 *   - travaux : AA-MM-JJ_<code site>_<nom d'origine>.<ext>
 *   - autres  : AA-MM-JJ_<nom d'origine>.<ext>
 * Si le nom existe déjà dans le dossier, un suffixe -2, -3... est ajouté.
 * @param {{ libnomId: number, refId: string, originalname: string, dossier: string }} params
 */
async function construireNomDocument({ libnomId, refId, originalname, dossier }) {
    const { nom, ext } = nettoyerNomOriginal(originalname);

    const morceaux = [dateCourte()];
    if (libnomId === LIBNOM_TRAVAUX) {
        morceaux.push(await codeSiteDuProjet(refId));
    }
    morceaux.push(nom);
    const base = morceaux.join("_");

    let nomFichier = base + ext;
    for (let i = 2; fs.existsSync(path.join(dossier, nomFichier)); i++) {
        nomFichier = `${base}-${i}${ext}`;
    }
    return nomFichier;
}

/**
 * Préfixe des vignettes en cache d'un document : les "/" du doc_path deviennent "_".
 * "photos/travaux/avant/26-10-08_10072_IMG-1234.jpg" -> { prefixe: "photos_travaux_avant_26-10-08_10072_IMG-1234", ext: ".jpg" }
 */
function prefixeCache(docPath) {
    const aplati = docPath.replace(/\//g, "_");
    const ext = path.extname(aplati);
    return { prefixe: path.basename(aplati, ext), ext };
}

/** Nom de la vignette en cache d'un document pour une largeur donnée : <prefixe>_<largeur><ext> */
function nomFichierCache(docPath, largeur) {
    const { prefixe, ext } = prefixeCache(docPath);
    return `${prefixe}_${largeur}${ext}`;
}

/**
 * Liste les vignettes en cache d'un document (toutes largeurs confondues).
 * Correspondance exacte "<prefixe>_<chiffres><ext>" : ne remonte pas les vignettes
 * d'un autre document dont le nom commence pareil (ex : "photo" vs "photo-2").
 * @returns {string[]} chemins absolus
 */
function fichiersCacheDuDocument(docPath, cacheDir) {
    const { prefixe, ext } = prefixeCache(docPath);
    const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const motif = new RegExp(`^${echapper(prefixe)}_\\d+${echapper(ext)}$`);

    if (!fs.existsSync(cacheDir)) return [];
    return fs
        .readdirSync(cacheDir)
        .filter((f) => motif.test(f))
        .map((f) => path.join(cacheDir, f));
}

module.exports = {
    slugifier,
    nettoyerNomOriginal,
    construireNomDocument,
    nomFichierCache,
    fichiersCacheDuDocument,
};
