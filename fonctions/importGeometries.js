// Import des emprises d'opérations (shapefile zippé ou GeoJSON) dans opegerer.localisations
//
// Principe : on ne fabrique plus le WKT à la main. Les géométries GeoJSON (celles du fichier
// GeoJSON, ou celles produites par la lecture du shapefile) sont passées telles quelles à PostGIS
// qui se charge de tout : passage en 2D, reprojection en Lambert 93, réparation, et fusion de
// toutes les entités du fichier en UNE géométrie Multi* (une ligne par import).
// Les colonnes cibles sont geometry(MultiPolygon|MultiLineString|MultiPoint, 2154).

const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const unzipper = require("unzipper");
const shapefile = require("shapefile");

const SRID_CIBLE = 2154;

// Emprise de validité de Lambert 93 (EPSG:2154), un peu élargie
const EMPRISE_L93 = { xmin: -400000, ymin: 6000000, xmax: 1300000, ymax: 7250000 };

// Type GeoJSON → colonne cible et dimension pour ST_CollectionExtract (1 point, 2 ligne, 3 polygone)
const FAMILLES = {
    POINT: { colonne: "loc_point", dim: 1, libelle: "point" },
    MULTIPOINT: { colonne: "loc_point", dim: 1, libelle: "point" },
    LINESTRING: { colonne: "loc_line", dim: 2, libelle: "ligne" },
    MULTILINESTRING: { colonne: "loc_line", dim: 2, libelle: "ligne" },
    POLYGON: { colonne: "loc_poly", dim: 3, libelle: "polygone" },
    MULTIPOLYGON: { colonne: "loc_poly", dim: 3, libelle: "polygone" },
};

// Fichiers d'un shapefile qu'on accepte d'extraire de l'archive
const EXTENSIONS_SHAPEFILE = new Set([".shp", ".shx", ".dbf", ".prj", ".cpg"]);
const TAILLE_MAX_EXTRAITE = 200 * 1024 * 1024; // garde-fou contre les archives piégées

/** Erreur « métier » portant le code HTTP à renvoyer au client */
class ImportGeometrieError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

/**
 * Extrait le shapefile d'une archive zip dans destDir, sous le nom shapefile.<ext>.
 * Les chemins de l'archive ne sont jamais réutilisés (pas de risque de « zip slip ») et on attend
 * la fin de l'écriture de chaque fichier avant de rendre la main.
 * @returns {Promise<{shp: string, prj: string|null}>} chemins des fichiers extraits
 */
async function extraireShapefile(zipPath, destDir) {
    let archive;
    try {
        archive = await unzipper.Open.file(zipPath);
    } catch (e) {
        throw new ImportGeometrieError(`Archive zip illisible : ${e.message}`);
    }

    // Regroupement des fichiers par nom sans extension (un groupe = un shapefile)
    const groupes = new Map();
    for (const entry of archive.files) {
        if (entry.type !== "File") continue;
        const morceaux = entry.path.split(/[\\/]/);
        if (morceaux.some((m) => m === "__MACOSX" || m.startsWith("._"))) continue;

        const ext = path.extname(entry.path).toLowerCase();
        if (!EXTENSIONS_SHAPEFILE.has(ext)) continue;

        const cle = entry.path.slice(0, -ext.length).toLowerCase();
        if (!groupes.has(cle)) groupes.set(cle, new Map());
        groupes.get(cle).set(ext, entry);
    }

    const shapefiles = [...groupes.entries()].filter(([, fichiers]) => fichiers.has(".shp"));
    if (shapefiles.length === 0) {
        throw new ImportGeometrieError("Aucun fichier .shp trouvé dans l'archive zip.");
    }
    if (shapefiles.length > 1) {
        const noms = shapefiles.map(([cle]) => path.basename(cle)).join(", ");
        throw new ImportGeometrieError(
            `L'archive contient plusieurs shapefiles (${noms}). Merci de n'en mettre qu'un seul.`
        );
    }

    const fichiers = shapefiles[0][1];
    const taille = [...fichiers.values()].reduce((t, e) => t + (e.uncompressedSize || 0), 0);
    if (taille > TAILLE_MAX_EXTRAITE) {
        throw new ImportGeometrieError("Le shapefile décompressé est trop volumineux.");
    }

    for (const [ext, entry] of fichiers) {
        await pipeline(entry.stream(), fs.createWriteStream(path.join(destDir, `shapefile${ext}`)));
    }

    return {
        shp: path.join(destDir, "shapefile.shp"),
        prj: fichiers.has(".prj") ? path.join(destDir, "shapefile.prj") : null,
    };
}

/** Lit toutes les géométries d'un fichier .shp (sans le .dbf : les attributs ne sont pas utilisés) */
async function lireGeometriesShapefile(shpPath) {
    const source = await shapefile.open(shpPath, null);
    const geometries = [];
    for (let r = await source.read(); !r.done; r = await source.read()) {
        geometries.push(r.value.geometry);
    }
    return geometries;
}

/**
 * Déduit le SRID du contenu d'un fichier .prj (WKT ESRI ou OGC).
 * @returns {number|null} null si la projection n'est pas reconnue
 */
function detecterSridPrj(prj) {
    if (!prj) return null;

    // WKT OGC : l'AUTHORITY de premier niveau ferme le texte
    const autorite = prj.match(/AUTHORITY\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]\s*\]\s*$/i);
    if (autorite) return parseInt(autorite[1], 10);

    if (/^\s*PROJCS/i.test(prj)) {
        if (/Lambert[_ -]?93/i.test(prj)) return 2154;
        const cc = prj.match(/CC[_ ]?(4[2-9]|50)\b/i);
        if (cc) return 3900 + parseInt(cc[1], 10);
        if (/Pseudo[_ -]?Mercator|Web[_ ]Mercator|Popular[_ ]Visualisation/i.test(prj)) return 3857;
        if (/Lambert[_ ]?(Zone[_ ]?)?II[_ ]?(e|é)tendu|Lambert_II_Extended|Lambert[_ ]II\b/i.test(prj)) return 27572;
        if (/UTM[_ ]?Zone[_ ]?31N/i.test(prj)) return /ETRS/i.test(prj) ? 25831 : 32631;
        return null;
    }

    if (/^\s*GEOGCS/i.test(prj)) {
        if (/WGS[_ ]?(19)?84/i.test(prj)) return 4326;
        if (/RGF[_ ]?(19)?93/i.test(prj)) return 4171;
        if (/ETRS[_ ]?(19)?89/i.test(prj)) return 4258;
    }
    return null;
}

/** Emprise [xmin, ymin, xmax, ymax] de toutes les coordonnées d'une liste de géométries GeoJSON */
function empriseCoordonnees(geometries) {
    const e = [Infinity, Infinity, -Infinity, -Infinity];
    const parcourir = (c) => {
        if (typeof c[0] === "number") {
            e[0] = Math.min(e[0], c[0]);
            e[1] = Math.min(e[1], c[1]);
            e[2] = Math.max(e[2], c[0]);
            e[3] = Math.max(e[3], c[1]);
        } else {
            c.forEach(parcourir);
        }
    };
    geometries.forEach((g) => parcourir(g.coordinates));
    return e;
}

/** Sans projection déclarée : des coordonnées en degrés trahissent du WGS84, sinon on suppose du Lambert 93 */
function deviner_srid(geometries) {
    const [xmin, ymin, xmax, ymax] = empriseCoordonnees(geometries);
    const enDegres = xmin >= -180 && xmax <= 180 && ymin >= -90 && ymax <= 90;
    return enDegres ? 4326 : SRID_CIBLE;
}

/**
 * Vérifie les géométries (non nulles, coordonnées présentes, une seule famille point/ligne/polygone).
 * @returns {{colonne: string, dim: number, libelle: string}} la famille commune
 */
function verifierGeometries(geometries) {
    if (geometries.length === 0) {
        throw new ImportGeometrieError("Aucune géométrie trouvée dans le fichier.");
    }

    let famille = null;
    for (const [i, g] of geometries.entries()) {
        const type = String(g.type || "").toUpperCase();
        const f = FAMILLES[type];
        if (!f) {
            throw new ImportGeometrieError(`Type de géométrie non supporté pour l'entité n°${i + 1} : ${g.type}`);
        }
        if (!Array.isArray(g.coordinates) || g.coordinates.length === 0) {
            throw new ImportGeometrieError(`L'entité n°${i + 1} (${g.type}) n'a pas de coordonnées.`);
        }
        if (famille && famille.colonne !== f.colonne) {
            throw new ImportGeometrieError(
                `Le fichier mélange des ${famille.libelle}s et des ${f.libelle}s : un seul type de géométrie par import.`
            );
        }
        famille = f;
    }
    return famille;
}

/**
 * Insère les géométries d'un import dans opegerer.localisations, en une transaction.
 * Toutes les entités sont fusionnées en une seule géométrie Multi* (une ligne par import).
 * @param {import("pg").Pool} pool
 * @param {Object[]} geometries - géométries GeoJSON (objets {type, coordinates})
 * @param {string} uuid_ope - opération à laquelle rattacher l'emprise
 * @param {number|null} sridSource - SRID des coordonnées (null : deviné d'après les coordonnées)
 */
async function insererLocalisation(pool, geometries, uuid_ope, sridSource) {
    // Les géométries nulles (entités sans forme dans un shapefile) sont ignorées
    geometries = geometries.filter((g) => g !== null && g !== undefined);
    const famille = verifierGeometries(geometries);
    const srid = sridSource || deviner_srid(geometries);
    const nbEntites = geometries.length;

    // Polygones : réparation puis union (gère les entités qui se chevauchent).
    // Points et lignes : simple collecte, pour garder les tronçons tels quels.
    const fusion =
        famille.dim === 3
            ? "ST_UnaryUnion(ST_Collect(ST_MakeValid(geom)))"
            : "ST_Collect(geom)";

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const ope = await client.query("SELECT 1 FROM opegerer.operations WHERE uuid_ope = $1", [uuid_ope]);
        if (ope.rowCount === 0) {
            throw new ImportGeometrieError(`Opération introuvable (uuid_ope = ${uuid_ope}).`, 404);
        }

        const insertion = await client.query(
            `WITH source AS (
                SELECT ST_Transform(ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON(g::text)), $2::int), ${SRID_CIBLE}) AS geom
                FROM jsonb_array_elements($1::jsonb) AS g
            ), fusion AS (
                SELECT ST_Multi(ST_CollectionExtract(${fusion}, ${famille.dim})) AS geom FROM source
            )
            INSERT INTO opegerer.localisations (${famille.colonne}, ref_uuid_ope)
            SELECT geom, $3 FROM fusion WHERE NOT ST_IsEmpty(geom)
            RETURNING loc_id,
                ST_NumGeometries(${famille.colonne}) AS nb_geometries,
                round(ST_Area(${famille.colonne})::numeric, 1) AS surface_m2,
                round(ST_Length(${famille.colonne})::numeric, 1) AS longueur_m,
                ST_XMin(${famille.colonne}) AS xmin, ST_YMin(${famille.colonne}) AS ymin,
                ST_XMax(${famille.colonne}) AS xmax, ST_YMax(${famille.colonne}) AS ymax`,
            [JSON.stringify(geometries), srid, uuid_ope]
        );

        if (insertion.rowCount === 0) {
            throw new ImportGeometrieError(
                `Les géométries du fichier sont vides ou dégénérées une fois converties en ${famille.libelle}s.`
            );
        }

        const loc = insertion.rows[0];
        if (
            loc.xmin < EMPRISE_L93.xmin || loc.ymin < EMPRISE_L93.ymin ||
            loc.xmax > EMPRISE_L93.xmax || loc.ymax > EMPRISE_L93.ymax
        ) {
            throw new ImportGeometrieError(
                `Les géométries tombent hors de France une fois reprojetées depuis l'EPSG:${srid}. ` +
                "Vérifiez la projection du fichier (Lambert 93 attendu, ou fichier .prj / crs correct)."
            );
        }

        await client.query("COMMIT");

        return {
            loc_id: loc.loc_id,
            type: famille.libelle,
            srid_source: srid,
            nb_entites: nbEntites,
            nb_geometries: loc.nb_geometries,
            surface_m2: famille.dim === 3 ? Number(loc.surface_m2) : null,
            longueur_m: famille.dim === 2 ? Number(loc.longueur_m) : null,
        };
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        // Erreurs PostGIS de lecture/reprojection des géométries : c'est le fichier qui est en cause
        if (!(error instanceof ImportGeometrieError) && ["XX000", "22023", "22P02"].includes(error.code)) {
            throw new ImportGeometrieError(`Géométrie invalide : ${error.message}`);
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    ImportGeometrieError,
    extraireShapefile,
    lireGeometriesShapefile,
    detecterSridPrj,
    insererLocalisation,
};
