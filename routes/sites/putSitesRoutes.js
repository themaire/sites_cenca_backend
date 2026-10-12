const express = require("express");
const router = express.Router();
import('uuid').then(module => {
    uuidv4 = module.v4;
    // ... le reste de ton code qui utilise uuidv4 ...
});

// Fonctions et connexion à PostgreSQL
const {
    ExecuteQuerySite,
    ExecuteQuerySitePromise,
    updateEspaceSite,
} = require("../../fonctions/fonctionsSites.js");
const {
    ImportGeometrieError,
    extraireShapefile,
    lireGeometriesShapefile,
    detecterSridPrj,
    insererLocalisation,
} = require("../../fonctions/importGeometries.js");
const pool = require("../../dbPool/poolConnect.js");

// Generateur de requetes SQL
const { generateUpdateQuery, generateInsertQuery, generateCloneQuery, getTableColums, generateCloneCheckboxQuery } = require('../../fonctions/querys.js');
const { authenticateToken } = require("../../fonctions/fonctionsAuth.js");
const { construireNomDocument } = require("../../fonctions/fonctionsFichiers.js");

// Code INSEE d'une commune : 5 caractères, 2A/2B pour la Corse
const INSEE_REGEX = /^\d[\dAB]\d{3}$/;

// Colonnes de sitcenca.projets_mfu de type tableau (int4[] ou varchar[]) : une chaîne vide
// n'est pas un littéral de tableau valide pour Postgres ("" ≠ "{}"), donc on la neutralise en null
// avant de construire la requête, plutôt que de laisser pg planter avec "malformed array literal".
const PMFU_ARRAY_COLUMNS = [
    "pmfu_territoire",
    "pmfu_appui",
    "pmfu_financements",
    "pmfu_parc_list",
    "pmfu_proch_etape",
    "pmfu_proprietaire",
    "pmfu_agence",
    "pmfu_commune_insee",
    "pmfu_commune_nom",
];

function sanitizePmfuArrayColumns(data) {
    for (const column of PMFU_ARRAY_COLUMNS) {
        if (data[column] === "") {
            data[column] = null;
        }
    }
    return data;
}

const multer = require("multer");
const fs = require("fs");
const path = require("path");
// const { exit } = require("process");
// const { get } = require("http");
// Obtenir le dossier racine du projet
const ROOT_DIR = path.join("/");
console.log("Racine du projet:", ROOT_DIR);
// 1. Définir le dossier des fichiers

const FILES_DIR = path.resolve(ROOT_DIR, "mnt", "storage_data", "app");
// 2. Définir le dossier des images

const IMAGES_DIR = path.resolve(FILES_DIR, "photos");
console.log("Dossier images:", IMAGES_DIR);

// 3. Définir le dossier des fichiers en cache
const CACHE_DIR = path.resolve(FILES_DIR, "cache");
console.log("Dossier cache:", CACHE_DIR);

let uploadFolders = {};
let uploadLibnoms = {}; // lib_field -> libnom_id (type de l'objet parent : pmfu, travaux...)

async function loadUploadFolders() {
    const rows = await ExecuteQuerySitePromise(pool, {
        query: "SELECT lib_path, lib_field, libnom_id FROM files.libelles",
    });

    uploadLibnoms = rows.rows.reduce((acc, row) => {
        acc[row.lib_field] = row.libnom_id;
        return acc;
    }, {});

    uploadFolders = rows.rows.reduce((acc, row) => {
        acc[row.lib_field] = row.lib_path;
        return acc;
    }, {});
    console.log("Vérification des dossiers de fichiers...");
    Object.values(uploadFolders).forEach((folderName) => {
        try {
            const folderPath = path.join(FILES_DIR, folderName);
            // Vérifier si le dossier existe déjà
            if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath, { recursive: true });
                console.log(`Dossier créé: ${folderPath}`);
            } else {
                console.log(`Dossier existe déjà: ${folderPath}`);
            }
        } catch (error) {
            console.error(
                `Erreur de création dossier ${folderName}:`,
                error.message
            );
        }
    });
}
// Appel au démarrage du serveur
loadUploadFolders();
// --- 1. Chargement dynamique des champs autorisés pour multer ---
let multerFieldsConfig = [];

async function loadMulterFieldsConfig() {
    try {
        const { rows } = await ExecuteQuerySitePromise(pool, {
            query: "SELECT lib_field, max_upload_count as max_count FROM files.libelles",
        });

        multerFieldsConfig = rows.map((row) => ({
            name: row.lib_field,
            maxCount: row.max_count,
        }));

        console.log("Champs Multer dynamiques chargés :", multerFieldsConfig);
    } catch (error) {
        console.error(
            "Erreur lors du chargement des champs Multer :",
            error.message
        );
    }
}
loadMulterFieldsConfig();

// Const storage pour renommer les pmfu_docs reçus
const storagePmfu = multer.diskStorage({
    destination: (req, file, cb) => {
        console.log("Le fichier reçu - tableau nommé file  :", file);

        // Récupération du dossier correspondant au nom
        const folderName = uploadFolders[file.fieldname] || "autres";
        const folder = path.join(FILES_DIR, folderName);

        // Changer temporairement le umask à 002
        const oldUmask = process.umask(0o002);
        fs.mkdirSync(folder, { recursive: true });
        process.umask(oldUmask);

        cb(null, folder);
    },
    // Nom selon le type de document (voir construireNomDocument) : ex. 26-10-08_10072_IMG-1234.jpg
    // ref_id doit précéder les fichiers dans le FormData pour être déjà lu ici.
    filename: (req, file, cb) => {
        const refId = req.body.ref_id;
        if (!refId) {
            return cb(new Error("ref_id manquant (il doit précéder les fichiers dans le formulaire)"));
        }
        const dossier = path.join(FILES_DIR, uploadFolders[file.fieldname] || "autres");

        construireNomDocument({
            libnomId: uploadLibnoms[file.fieldname],
            refId,
            originalname: file.originalname,
            dossier,
        })
            .then((nom) => cb(null, nom))
            .catch(cb);
    },
});

// Filtrage des fichiers
const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "image/jpg",
        "image/jpeg",
        "image/png",
    ];

    const allowedExtensions = [
        ".pdf",
        ".doc",
        ".docx",
        ".png",
        ".jpg",
        ".jpeg",
    ];

    const ext = path.extname(file.originalname).toLowerCase();
    console.log(" Tentative d'upload:", file.originalname, ">", file.mimetype);
    if (
        allowedMimeTypes.includes(file.mimetype) ||
        allowedExtensions.includes(ext)
    ) {
        cb(null, true);
    } else {
        console.log(
            " Rejet du fichier:",
            file.originalname,
            ">",
            file.mimetype
        );
        cb(new Error("Format de fichier non supporté."));
    }
};
// Configuration Multer pour les fichiers géographiques (shapefile zippé ou GeoJSON)
const TAILLE_MAX_FICHIER_GEO = 50 * 1024 * 1024; // 50 Mo

function multerFichierGeo(extensions, libelle) {
    return multer({
        dest: "uploads/",
        limits: { fileSize: TAILLE_MAX_FICHIER_GEO, files: 1 },
        fileFilter: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            if (extensions.includes(ext)) {
                cb(null, true);
            } else {
                cb(new ImportGeometrieError(`Format de fichier non supporté. Seuls les ${libelle} sont acceptés.`));
            }
        },
    }).single("file");
}

/**
 * Enveloppe un middleware multer pour renvoyer ses erreurs (format, taille) en JSON 400
 * au lieu de la page d'erreur HTML d'Express.
 */
function avecMulter(middleware) {
    return (req, res, next) => {
        middleware(req, res, (err) => {
            if (!err) return next();
            const message = err.code === "LIMIT_FILE_SIZE"
                ? `Fichier trop volumineux (${TAILLE_MAX_FICHIER_GEO / 1024 / 1024} Mo maximum).`
                : err.message;
            res.status(400).json({ success: false, message });
        });
    };
}

const multerMiddlewareZip = avecMulter(multerFichierGeo([".zip"], ".zip"));
const multerMiddlewareGeoJSON = avecMulter(multerFichierGeo([".geojson", ".json"], ".geojson et .json"));

/**
 * Middleware Multer pour l'upload de documents
 * @returns {import("multer").Multer}
 */
function createMulterMiddlewareDoc() {
    return multer({
        storage: storagePmfu,
        fileFilter,
    }).fields(multerFieldsConfig);
}

let multerMiddlewareDoc = createMulterMiddlewareDoc();

// Mettre à jour un site, un acte, un projet, une operation ...
router.put("/put/table=:table/uuid=:uuid", (req, res) => {
    const TABLE = req.params.table;
    const UUID = req.params.uuid; // UUID du site à mettre à jour
    const updateData = req.body; // Récupérer l'objet JSON envoyé

    try {
        if (TABLE === "espace_site") {
            // Séparer les champs pour les tables 'espace' et 'site' afin de les insérer dans les bonnes tables
            // d'utiliser les bonnes fonctions de création de requetes update
            const espaceFields = [
                "date_crea_espace",
                "id_espace",
                "nom",
                "surface",
                "carto_hab",
                "zh",
                "typ_espace",
                "bassin_agence",
                "rgpt",
                "typ_geologie",
                "id_source",
                "id_crea",
                "url",
                "maj_admin",
            ];
            const siteFields = [
                "code",
                "prem_ctr",
                "ref_fcen",
                "pourc_gere",
                "surf_actes",
                "url_cen",
                "validite",
                "espace",
                "typ_site",
                "responsable",
                "date_crea_site",
                "id_mnhn",
                "modif_admin",
                "actuel",
                "url_mnhn",
                "parties_gerees",
                "typ_ouverture",
                "description_site",
                "sensibilite",
                "remq_sensibilite",
                "ref_public",
            ];

            const espaceData = {};
            const siteData = {};

            Object.keys(updateData).forEach((key) => {
                if (espaceFields.includes(key)) {
                    espaceData[key] = updateData[key];
                } else if (siteFields.includes(key)) {
                    siteData[key] = updateData[key];
                }
            });

            // console.log(espaceData);
            // console.log(siteData);

            // Un formulaire peut ne modifier qu'une des deux tables :
            // on ne génère l'UPDATE que pour les tables qui ont des colonnes à modifier.
            if (!Object.keys(espaceData).length && !Object.keys(siteData).length) {
                return res.status(400).json({
                    success: false,
                    message: "Aucune colonne modifiable fournie.",
                });
            }

            // Générer les requêtes UPDATE pour chaque table
            // Ne PAS oublier d'ajouter l'UUID de la bonne table
            const espaceQuery = Object.keys(espaceData).length
                ? generateUpdateQuery(
                      "esp.espaces",
                      updateData.uuid_espace,
                      espaceData
                  )
                : null;
            const siteQuery = Object.keys(siteData).length
                ? generateUpdateQuery("sitcenca.sites", UUID, siteData)
                : null;

            updateEspaceSite(pool, res, espaceQuery, siteQuery);
        } else if (["projets", "operations", "objectifs"].includes(TABLE)) {
            console.log("updateData");
            console.log(updateData);

            const queryObject = generateUpdateQuery(
                "opegerer." + TABLE,
                UUID,
                updateData
            );
            console.log(queryObject);

            ExecuteQuerySite(
                pool,
                {
                    query: queryObject,
                    message: "sites/put/table=" + TABLE + "/uuid",
                },
                "update",
                (resultats, message) => {
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader(
                        "Content-Type",
                        "application/json; charset=utf-8"
                    );

                    if (message === "ok") {
                        res.status(200).json({
                            success: true,
                            message: "Mise à jour réussie.", // sera visible dans le snackbar
                            data: resultats,
                        });
                        console.log("message : " + message);
                        console.log("resultats : " + resultats);
                    } else {
                        const currentDateTime = new Date().toISOString();
                        console.log(`Échec de la requête à ${currentDateTime}`);
                        console.log(queryObject.text);
                        console.log(queryObject.values);
                        res.status(500).json({
                            success: false,
                            message: "Erreur, la requête s'est mal exécutée.",
                        });
                    }
                }
            );
        } else if (TABLE === "actes_mfu") {
            console.log("Coucou je suis passé par là pour la table " + TABLE);
            // spécifier le schema pour que generateUpdateQuery puisse extraire correctement le nom
            const queryObject = generateUpdateQuery(
                "sitcenca." + TABLE, UUID, updateData);
            console.log(queryObject);

            ExecuteQuerySite(
                pool,
                {
                    query: queryObject,
                    message: "sites/put/table=" + TABLE + "/uuid",
                },
                "update",
                (resultats, message) => {
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader(
                        "Content-Type",
                        "application/json; charset=utf-8"
                    );

                    if (message === "ok") {
                        res.status(200).json({
                            success: true,
                            message: "Mise à jour réussie.",
                            data: resultats,
                        });
                        console.log("message : " + message);
                        console.log("resultats : " + resultats);
                    } else {
                        const currentDateTime = new Date().toISOString();
                        console.log(`Échec de la requête à ${currentDateTime}`);
                        console.log(queryObject.text);
                        console.log(queryObject.values);
                        res.status(500).json({
                            success: false,
                            message: "Erreur, la requête s'est mal exécutée.",
                        });
                    }
                }
            );
        } else if (TABLE === "parcelles_mfu") {
            console.log("Coucou je suis passé par là pour la table " + TABLE);
            // spécifier le schema pour que generateUpdateQuery puisse extraire correctement le nom
            const queryObject = generateUpdateQuery(
                "sitcenca." + TABLE, UUID, updateData);
            console.log(queryObject);

            ExecuteQuerySite(
                pool,
                {
                    query: queryObject,
                    message: "sites/put/table=" + TABLE + "/uuid",
                },
                "update",
                (resultats, message) => {
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader(
                        "Content-Type",
                        "application/json; charset=utf-8"
                    );

                    if (message === "ok") {
                        res.status(200).json({
                            success: true,
                            message: "Mise à jour réussie.",
                            data: resultats,
                        });
                        console.log("message : " + message);
                        console.log("resultats : " + resultats);
                    } else {
                        const currentDateTime = new Date().toISOString();
                        console.log(`Échec de la requête à ${currentDateTime}`);
                        console.log(queryObject.text);
                        console.log(queryObject.values);
                        res.status(500).json({
                            success: false,
                            message: "Erreur, la requête s'est mal exécutée.",
                        });
                    }
                }
            );
        } else if (TABLE === "projets_mfu") {
            const queryObject = generateUpdateQuery(
                "sitcenca." + TABLE,
                UUID,
                sanitizePmfuArrayColumns(updateData)
            );
            ExecuteQuerySitePromise(pool, {
                query: queryObject,
                message: "...",
            })
                .then(({ rows: resultats, message }) => {
                    res.status(200).json({
                        success: true,
                        message: "Mise à jour réussie.",
                        data: resultats,
                    });
                    console.log("message :", message);
                    console.log("resultats :", resultats);
                })
                .catch((err) => {
                    console.error(err);
                    res.status(500).json({
                        success: false,
                        message: "Erreur serveur",
                    });
                });
        } else if (TABLE === "docplan_documents") {
            const queryObject = generateUpdateQuery("docplan.documents", UUID, updateData);
            console.log(queryObject);
            ExecuteQuerySite(
                pool,
                { query: queryObject, message: "sites/put/table=docplan_documents/uuid" },
                "update",
                (resultats, message) => {
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    if (message === "ok") {
                        res.status(200).json({
                            success: true,
                            message: "Mise à jour réussie.",
                            data: resultats,
                        });
                    } else {
                        res.status(500).json({
                            success: false,
                            message: "Erreur, la requête s'est mal exécutée.",
                        });
                    }
                }
            );
        } else {
            res.status(400).json({
                success: false,
                message: "Table invalide.",
            });
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour : ", error);
        res.status(500).json({
            success: false,
            message: "Erreur interne du serveur.",
        });
    }
});

// Ajouter un site, un acte, une parcelle, une operation ...
router.put("/put/table=:table/insert", async (req, res) => {
    // console.log("La requête : ", req);
    const TABLE = req.params.table;
    const INSERT_DATA = req.body; // Récupérer l'objet JSON envoyé
    console.log("INSERT_DATA de la requête : ", INSERT_DATA);

    const MESSAGE = "sites/put/table=" + TABLE + "/insert";
    // Tables possibles pour des differents insert. En clé le nom de la table, en valeur son schema
    const TABLES = {
        sites: "sitcenca",
        actes_mfu: "sitcenca",
        actes_mfu_multi: "sitcenca",
        parcelles_mfu: "sitcenca",
        projets_mfu: "sitcenca",
        pmfu_docs: "sitcenca",
        projets: "opegerer",
        operations: "opegerer",
        objectifs: "opegerer",
        operation_financeurs: "opegerer",
        operation_animaux: "opegerer",
    };

    // Mapping nom-route → nom complet de table pour les tables docplan
    const DOCPLAN_TABLES = {
        docplan_documents: "docplan.documents",
        docplan_unites_gestion: "docplan.unites_gestion",
        docplan_entites_coherentes: "docplan.entites_coherentes",
    };

    // Ajout d'un projet_mfu
    try {
        if (TABLE === "projets_mfu") {
            sanitizePmfuArrayColumns(INSERT_DATA);
            console.log("data avant envoi :", INSERT_DATA.pmfu_id);
            if (INSERT_DATA.pmfu_id === 0) {
                const selectField = "SELECT MAX(pmfu_id) AS max_pmfu_id";
                const fromTable = " FROM sitcenca.projets_mfu";
                const queryText = selectField + fromTable;
                console.log("queryText pour pmfu_id :", queryText);
                ExecuteQuerySitePromise(pool, {
                    query: queryText,
                    message: "sites/put/table=" + TABLE + "/insert",
                })
                    .then(({ rows: resultats, message }) => {
                        console.log("resultats de pmfu_id :", resultats);
                        const maxPmfuId = resultats[0].max_pmfu_id;
                        INSERT_DATA.pmfu_id = maxPmfuId + 1;
                        console.log(
                            "INSERT_DATA.pmfu_id :",
                            INSERT_DATA.pmfu_id
                        );
                        const queryObject = generateInsertQuery(
                            "sitcenca." + TABLE,
                            INSERT_DATA,
                            false
                        );
                        console.log(queryObject);
                        ExecuteQuerySitePromise(pool, {
                            query: queryObject,
                            message: MESSAGE,
                        })
                            .then(({ rows: resultats, message }) => {
                                res.status(200).json({
                                    success: true,
                                    message: "Mise à jour réussie.",
                                    data: INSERT_DATA.pmfu_id,
                                });
                                console.log("message :", message);
                                console.log("resultats :", resultats);
                            })
                            .catch((err) => {
                                console.error(err);
                                res.status(500).json({
                                    success: false,
                                    message: "Erreur serveur",
                                });
                            });
                    })
                    .catch((err) => {
                        console.error(err);
                        res.status(500).json({
                            success: false,
                            message: "Erreur serveur",
                        });
                    });
            } else {
                const queryObject = generateInsertQuery(
                    "sitcenca." + TABLE,
                    INSERT_DATA,
                    false
                );
                console.log(queryObject);
                ExecuteQuerySite(
                    pool,
                    { query: queryObject, message: MESSAGE },
                    "insert",
                    (resultats, message) => {
                        res.setHeader("Access-Control-Allow-Origin", "*");
                        res.setHeader(
                            "Content-Type",
                            "application/json; charset=utf-8"
                        );
                        if (resultats && resultats.length > 0) {
                            res.status(200).json({
                                success: true,
                                message: "Mise à jour réussie.",
                                data: resultats,
                            });
                            console.log("message : " + message);
                            console.log("resultats : " + resultats);
                        } else {
                            const currentDateTime = new Date().toISOString();
                            console.log(
                                `Échec de la requête 1 à ${currentDateTime}`
                            );
                            console.log(queryObject.text);
                            console.log(queryObject.values);
                            res.status(500).json({
                                success: false,
                                message:
                                    "Erreur, la requête s'est mal exécutée.",
                            });
                        }
                    }
                );
            }
        } else if (TABLE === "espace_site") {
            // Cas spécial : "espace_site" n'est pas une vraie table. La création d'un site
            // impose de créer une ligne dans esp.espaces ET une ligne dans sitcenca.sites
            // (rattachée via sites.espace), dans une seule transaction : si l'une des deux
            // requêtes échoue, l'autre est annulée (voir le mapping des champs déjà utilisé
            // pour l'update du même nom spécial ci-dessus, route /put/table=espace_site/uuid).
            const espaceFields = [
                "nom",
                "surface",
                "typ_espace",
                "bassin_agence",
                "zh",
                "rgpt",
            ];
            const siteFields = [
                "code",
                "responsable",
                "typ_site",
                "validite",
                "prem_ctr",
                "ref_public",
                "id_mnhn",
                "ref_fcen",
                "description_site",
                "sensibilite",
                "remq_sensibilite",
                "typ_ouverture",
                "url_cen",
                "url_mnhn",
                "ref_pmfu_id",
                "parties_gerees"
            ];

            const espaceData = {};
            const siteData = {};

            Object.keys(INSERT_DATA).forEach((key) => {
                if (espaceFields.includes(key)) {
                    espaceData[key] = INSERT_DATA[key];
                } else if (siteFields.includes(key)) {
                    siteData[key] = INSERT_DATA[key];
                }
            });

            // Validation minimale des champs requis par le formulaire de création
            const REQUIRED_TEXT_FIELDS = {
                nom: espaceData.nom,
                surface: espaceData.surface,
                code: siteData.code,
                responsable: siteData.responsable,
                typ_site: siteData.typ_site,
                description_site: siteData.description_site,
            };
            // Site en gestion (typ_site = 1) : le n° PMFU est obligatoire
            if (String(siteData.typ_site) === "1") {
                REQUIRED_TEXT_FIELDS.ref_pmfu_id = siteData.ref_pmfu_id;
            }
            const missingField = Object.keys(REQUIRED_TEXT_FIELDS).find(
                (key) =>
                    REQUIRED_TEXT_FIELDS[key] === undefined ||
                    REQUIRED_TEXT_FIELDS[key] === null ||
                    REQUIRED_TEXT_FIELDS[key] === ""
            );
            if (missingField || siteData.validite === undefined || siteData.validite === null) {
                res.status(400).json({
                    success: false,
                    message:
                        "Champ requis manquant : " + (missingField || "validite") + ".",
                });
                return;
            }

            // Génération des UUID côté serveur
            const uuid_espace = uuidv4();
            const uuid_site = uuidv4();
            espaceData.uuid_espace = uuid_espace;
            siteData.uuid_site = uuid_site;
            siteData.espace = uuid_espace; // FK vers esp.espaces

            const espaceQuery = generateInsertQuery("esp.espaces", espaceData, false);
            const siteQuery = generateInsertQuery("sitcenca.sites", siteData, false);

            const client = await pool.connect();
            try {
                await client.query("BEGIN");
                await client.query(espaceQuery.text, espaceQuery.values);
                await client.query(siteQuery.text, siteQuery.values);
                await client.query("COMMIT");

                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.status(201).json({
                    success: true,
                    code: 0,
                    message: "Site créé avec succès",
                    data: { uuid_espace, uuid_site },
                });
            } catch (error) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
                    console.error(
                        "Erreur lors du ROLLBACK de la création du site (espace_site) :",
                        rollbackError
                    );
                }
                console.error(
                    "Erreur lors de la création du site (espace_site) :",
                    error
                );
                res.status(500).json({
                    success: false,
                    message: "Erreur, la création du site a échoué.",
                });
            } finally {
                client.release();
            }
        } else if (Object.keys(TABLES).includes(TABLE)) {
            const WORKING_TABLE = TABLES[TABLE] + "." + TABLE;
            console.log("WORKING_TABLE : " + WORKING_TABLE);

            const queryObject = generateInsertQuery(
                WORKING_TABLE,
                INSERT_DATA,
                false
            );
            console.log("Requête générée pour " + TABLE + " :");
            console.log("SQL:", queryObject.text);
            console.log("Values:", queryObject.values);

            ExecuteQuerySite(
                pool,
                { query: queryObject, message: MESSAGE },
                "insert",
                (resultats, message) => {
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader(
                        "Content-Type",
                        "application/json; charset=utf-8"
                    );

                    if (message === "ok") {
                        res.status(201).json({
                            success: true,
                            message: "Insert réussie.",
                            code: 0,
                            data: resultats,
                        });
                        console.log("message : " + message);
                        console.log("resultats : " + resultats);
                    } else {
                        const currentDateTime = new Date().toISOString();
                        console.log(`Échec de la requête à ${currentDateTime}`);
                        console.log("SQL:", queryObject.text);
                        console.log("Values:", queryObject.values);
                        console.log("Message d'erreur:", message);
                        res.status(500).json({
                            success: false,
                            message: "Erreur, la requête s'est mal exécutée. Détails: " + message,
                        });
                    }
                }
            );
        } else if (Object.keys(DOCPLAN_TABLES).includes(TABLE)) {
            const WORKING_TABLE = DOCPLAN_TABLES[TABLE];
            console.log("WORKING_TABLE (docplan) : " + WORKING_TABLE);

            const queryObject = generateInsertQuery(WORKING_TABLE, INSERT_DATA, false);
            console.log("SQL:", queryObject.text);
            console.log("Values:", queryObject.values);

            ExecuteQuerySite(
                pool,
                { query: queryObject, message: MESSAGE },
                "insert",
                (resultats, message) => {
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    if (message === "ok") {
                        res.status(201).json({
                            success: true,
                            message: "Insert réussie.",
                            code: 0,
                            data: resultats,
                        });
                    } else {
                        res.status(500).json({
                            success: false,
                            message: "Erreur, la requête s'est mal exécutée.",
                        });
                    }
                }
            );
        } else {
            const BAD_MESSAGE =
                "Table " +
                TABLE +
                " inconnue dans la liste des tables connues.";
            console.log(BAD_MESSAGE);
            res.status(400).json({
                success: false,
                message: BAD_MESSAGE,
            });
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour : ", error);
        console.error("Erreur lors de la mise à jour : ", error);
        res.status(500).json({
            success: false,
            message: "Erreur interne du serveur.",
        });
    }
});

// Dupliquer un projet complet ou une operation.
router.put("/put/table=:table/clone", (req, res) => {
    const TABLE = req.params.table;
    const INSERT_DATA = req.body; // Récupérer l'objet JSON envoyé
    console.log("Body reçu pour la duplication :", INSERT_DATA);
    const MESSAGE = "sites/put/table=" + TABLE + "/clone";
    // Tables possibles pour des differents insert. En clé le nom de la table, en valeur son schema
    const TABLES = { 'projets': 'opegerer', 'operations': 'opegerer' };

    try {

        if (Object.keys(TABLES).includes(TABLE)) {

            const WORKING_TABLE = TABLES[TABLE] + "." + TABLE;
            console.log("WORKING_TABLE : " + WORKING_TABLE);

            const queryFields = getTableColums(TABLES[TABLE], TABLE);
            console.log(queryFields);

            // Premiere execution de requete pour obtnenir la liste des champs de la table cible
            ExecuteQuerySite(
                pool,
                { query: queryFields, message: MESSAGE },
                "select",
                (fields, message) => {

                    console.log("fields obtenus par la requête : ");
                    console.log(fields);

                    if (fields && fields.length > 0) { // Si on a bien des champs retournés
                        // par exemple :
                        //  [
                        //   { column_name: 'uuid_ope' },
                        //   { column_name: 'code' },
                        //   { column_name: 'titre' },

                        // Générer la requête d'insertion avec les bons champs
                        const newUUID = uuidv4();
                        const queryObject = generateCloneQuery(WORKING_TABLE, fields[0]['column_name'], fields, INSERT_DATA["id"], newUUID, INSERT_DATA["excludeFieldsGroups"]);
                        console.log(queryObject);

                        // Deuxième execution de requete pour cloner cette fois ci l'élement souhaité
                        ExecuteQuerySite(
                            pool,
                            { query: queryObject, message: MESSAGE },
                            "insert",
                            (resultats, message) => {
                                res.setHeader("Access-Control-Allow-Origin", "*");
                                res.setHeader("Content-Type", "application/json; charset=utf-8");

                                if (message === 'ok') { // le message est ok est dans le cas hors d'un select
                                    if (TABLE == 'operations') {
                                        // Si on clone une operation, on doit aussi cloner ses financeurs et animaux liés
                                        const queryCloneFinanceurs = generateCloneCheckboxQuery('opegerer.operation_financeurs', INSERT_DATA["id"], newUUID);
                                        ExecuteQuerySite(
                                            pool,
                                            { query: queryCloneFinanceurs, message: MESSAGE },
                                            "insert",
                                            (resultats, message) => {
                                                if (message === 'ok') {
                                                    console.log("Financeurs clonés avec succès.");
                                                } else {
                                                    console.error("Erreur lors du clonage des financeurs.");
                                                }
                                            }
                                        );

                                        const queryCloneAnimaux = generateCloneCheckboxQuery('opegerer.operation_animaux', INSERT_DATA["id"], newUUID);
                                        ExecuteQuerySite(
                                            pool,
                                            { query: queryCloneAnimaux, message: MESSAGE },
                                            "insert",
                                            (resultats, message) => {
                                                if (message === 'ok') {
                                                    console.log("Animaux clonés avec succès.");
                                                } else {
                                                    console.error("Erreur lors du clonage des animaux.");
                                                }
                                            }
                                        );
                                    }
                                    res.status(201).json({
                                        success: true,
                                        message: "Duplication réussie de la ligne " + INSERT_DATA["id"] + " dans la table " + WORKING_TABLE + ".",
                                        code: 0,
                                        data: resultats
                                    });
                                    console.log("message : " + message);
                                    console.log("resultats : " + resultats);
                                } else {
                                    const currentDateTime = new Date().toISOString();
                                    console.log(`Échec de la requête à ${currentDateTime}`);
                                    console.log(queryObject.text);
                                    console.log(queryObject.values);
                                    res.status(500).json({
                                        success: false,
                                        message: "Erreur, la requête s'est mal exécutée."
                                    });
                                }
                            }
                        );


                    } else {
                        const currentDateTime = new Date().toISOString();
                        console.log(`Échec de la requête de récupèration des colonnes à ${currentDateTime}`);
                        console.log("Message de la fonction callback : " + message);
                        console.log(queryFields.text);
                        console.log(queryFields.values);
                        res.status(500).json({
                            success: false,
                            message: "Erreur, la requête s'est mal exécutée."
                        });
                    }
                }
            );



        } else {
            const BAD_MESSAGE = "Table " + TABLE + " inconnue dans la liste des tables connues.";
            console.log(BAD_MESSAGE);
            res.status(400).json({
                success: false,
                message: BAD_MESSAGE
            });
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour : ", error);
        res.status(500).json({
            success: false,
            message: "Erreur interne du serveur."
        });
    }
});

// Dupliquer un projet complet : le projet lui-même, son (ses) objectif(s) rattaché(s)
// (opegerer.objectifs.projet) et toutes les opérations qui lui sont rattachées (ref_uuid_proj),
// avec pour chacune ses financeurs et animaux.
// S'appuie sur la même mécanique que la route de duplication ci-dessus (generateCloneQuery /
// generateCloneCheckboxQuery), mais l'ensemble tourne dans une seule transaction : soit tout
// est dupliqué, soit rien ne l'est (un échec en cours de route ne doit pas laisser un
// projet cloné à moitié peuplé).
router.put("/put/projet_complet/clone", async (req, res) => {
    const INSERT_DATA = req.body;
    const projetId = INSERT_DATA["id"];
    const excludeFieldsGroups = INSERT_DATA["excludeFieldsGroups"];
    const MESSAGE = "sites/put/projet_complet/clone";
    console.log(MESSAGE + " - Body reçu :", INSERT_DATA);

    if (!projetId) {
        return res.status(400).json({
            success: false,
            message: "Identifiant du projet (id) manquant.",
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // 1. Cloner le projet lui-même
        const projetColumnsQuery = getTableColums("opegerer", "projets");
        const projetColumnsResult = await client.query(projetColumnsQuery.text, projetColumnsQuery.values);

        if (!projetColumnsResult.rows.length) {
            throw new Error("Impossible de récupérer les colonnes de opegerer.projets.");
        }

        const projetPk = projetColumnsResult.rows[0].column_name;
        const newProjUUID = uuidv4();

        const cloneProjetQuery = generateCloneQuery(
            "opegerer.projets",
            projetPk,
            projetColumnsResult.rows,
            projetId,
            newProjUUID,
            excludeFieldsGroups
        );
        const cloneProjetResult = await client.query(cloneProjetQuery.text, cloneProjetQuery.values);

        if (cloneProjetResult.rowCount === 0) {
            throw new Error("Le projet à dupliquer est introuvable (id : " + projetId + ").");
        }

        // 2. Cloner le(s) objectif(s) rattaché(s) au projet d'origine (opegerer.objectifs.projet)
        const objectifsACloner = await client.query(
            "SELECT uuid_objectif FROM opegerer.objectifs WHERE projet = $1",
            [projetId]
        );

        let objectifsColumns = null;
        const clonedObjectifs = [];

        for (const { uuid_objectif: oldObjectifUUID } of objectifsACloner.rows) {
            if (!objectifsColumns) {
                const objectifsColumnsQuery = getTableColums("opegerer", "objectifs");
                const objectifsColumnsResult = await client.query(objectifsColumnsQuery.text, objectifsColumnsQuery.values);
                objectifsColumns = objectifsColumnsResult.rows;
            }

            const objectifsPk = objectifsColumns[0].column_name;
            const newObjectifUUID = uuidv4();

            const cloneObjectifQuery = generateCloneQuery(
                "opegerer.objectifs",
                objectifsPk,
                objectifsColumns,
                oldObjectifUUID,
                newObjectifUUID,
                excludeFieldsGroups,
                { projet: newProjUUID }
            );
            await client.query(cloneObjectifQuery.text, cloneObjectifQuery.values);

            clonedObjectifs.push({ ancien: oldObjectifUUID, nouveau: newObjectifUUID });
        }

        // 3. Récupérer les opérations rattachées au projet d'origine
        const operationsACloner = await client.query(
            "SELECT uuid_ope FROM opegerer.operations WHERE ref_uuid_proj = $1",
            [projetId]
        );

        // 4. Cloner chaque opération en la rattachant au nouveau projet (ref_uuid_proj), avec ses financeurs/animaux
        let operationsColumns = null;
        const clonedOperations = [];

        for (const { uuid_ope: oldOpeUUID } of operationsACloner.rows) {
            if (!operationsColumns) {
                const operationsColumnsQuery = getTableColums("opegerer", "operations");
                const operationsColumnsResult = await client.query(operationsColumnsQuery.text, operationsColumnsQuery.values);
                operationsColumns = operationsColumnsResult.rows;
            }

            const operationsPk = operationsColumns[0].column_name;
            const newOpeUUID = uuidv4();

            const cloneOperationQuery = generateCloneQuery(
                "opegerer.operations",
                operationsPk,
                operationsColumns,
                oldOpeUUID,
                newOpeUUID,
                excludeFieldsGroups,
                { ref_uuid_proj: newProjUUID }
            );
            await client.query(cloneOperationQuery.text, cloneOperationQuery.values);

            const cloneFinanceursQuery = generateCloneCheckboxQuery("opegerer.operation_financeurs", oldOpeUUID, newOpeUUID);
            await client.query(cloneFinanceursQuery.text, cloneFinanceursQuery.values);

            const cloneAnimauxQuery = generateCloneCheckboxQuery("opegerer.operation_animaux", oldOpeUUID, newOpeUUID);
            await client.query(cloneAnimauxQuery.text, cloneAnimauxQuery.values);

            clonedOperations.push({ ancien: oldOpeUUID, nouveau: newOpeUUID });
        }

        await client.query("COMMIT");

        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.status(201).json({
            success: true,
            message: "Duplication réussie du projet " + projetId + " (" + clonedObjectifs.length + " objectif(s) et " + clonedOperations.length + " opération(s) dupliqué(s)).",
            code: 0,
            data: {
                uuid_proj: newProjUUID,
                objectifs: clonedObjectifs,
                operations: clonedOperations,
            },
        });
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error("Erreur lors du ROLLBACK de la duplication du projet complet :", rollbackError);
        }
        console.error("Erreur lors de la duplication du projet complet : ", error);
        res.status(500).json({
            success: false,
            message: "Erreur, la duplication du projet a échoué.",
        });
    } finally {
        client.release();
    }
});

/**
 * Vérifie la présence du fichier et de l'uuid de l'opération,
 * commun aux routes d'import de géométrie.
 */
function verifierRequeteImportGeo(req, res, next) {
    if (!req.file) {
        return res.status(400).json({ success: false, message: "Aucun fichier n'a été envoyé" });
    }
    if (typeof req.body.uuid_ope !== "string" || req.body.uuid_ope.trim() === "") {
        fs.promises.rm(req.file.path, { force: true }).catch(() => {});
        return res.status(400).json({ success: false, message: "UUID de l'opération manquant (uuid_ope requis)" });
    }
    next();
}

/** Réponse commune aux routes d'import de géométrie */
function repondreImportGeo(res, resultat) {
    const mesure = resultat.surface_m2 !== null
        ? ` (${(resultat.surface_m2 / 10000).toFixed(2)} ha)`
        : resultat.longueur_m !== null ? ` (${Math.round(resultat.longueur_m)} m)` : "";
    res.status(200).json({
        success: true,
        message: `${resultat.nb_entites} entité(s) de type ${resultat.type} importée(s)${mesure}.`,
        data: resultat,
    });
}

function repondreErreurImportGeo(res, error) {
    console.error("Erreur import géométrie :", error);
    const status = error instanceof ImportGeometrieError ? error.status : 500;
    res.status(status).json({
        success: false,
        message: status === 500 ? "Erreur serveur lors de l'import de la géométrie." : error.message,
    });
}

// Import d'une emprise d'opération depuis un shapefile zippé.
// Le type de géométrie et la projection (.prj) sont lus dans le fichier ;
// le champ type_geometry envoyé par le front n'est plus utilisé.
router.post(
    "/put/ope_shapefile",
    authenticateToken,
    multerMiddlewareZip,
    verifierRequeteImportGeo,
    async (req, res) => {
        const zipPath = req.file.path;
        let dossierTravail = null;

        try {
            console.log(`Import shapefile « ${req.file.originalname} » pour l'opération ${req.body.uuid_ope}`);

            // Un dossier par requête : deux imports simultanés ne se marchent plus dessus
            const racineExtraction = path.join(__dirname, "../../uploads/extracted");
            await fs.promises.mkdir(racineExtraction, { recursive: true });
            dossierTravail = await fs.promises.mkdtemp(path.join(racineExtraction, "shp-"));

            const { shp, prj } = await extraireShapefile(zipPath, dossierTravail);
            const contenuPrj = prj ? await fs.promises.readFile(prj, "utf8") : null;
            const srid = detecterSridPrj(contenuPrj);
            if (contenuPrj && !srid) {
                console.warn("Projection .prj non reconnue, déduite des coordonnées :", contenuPrj.slice(0, 200));
            }

            const geometries = await lireGeometriesShapefile(shp);
            const resultat = await insererLocalisation(pool, geometries, req.body.uuid_ope.trim(), srid);
            console.log("Import shapefile réussi :", resultat);
            repondreImportGeo(res, resultat);
        } catch (error) {
            repondreErreurImportGeo(res, error);
        } finally {
            await fs.promises.rm(zipPath, { force: true }).catch(() => {});
            if (dossierTravail) {
                await fs.promises.rm(dossierTravail, { recursive: true, force: true }).catch(() => {});
            }
        }
    }
);

// Import d'une emprise d'opération depuis un fichier GeoJSON.
// Projection lue dans le membre "crs" ; à défaut WGS84 (norme GeoJSON) ou Lambert 93 selon les coordonnées.
router.post(
    "/put/ope_geojson",
    authenticateToken,
    multerMiddlewareGeoJSON,
    verifierRequeteImportGeo,
    async (req, res) => {
        const filePath = req.file.path;

        try {
            console.log(`Import GeoJSON « ${req.file.originalname} » pour l'opération ${req.body.uuid_ope}`);

            let geojson;
            try {
                geojson = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
            } catch (parseError) {
                throw new ImportGeometrieError(`Fichier JSON invalide : ${parseError.message}`);
            }

            let geometries;
            if (geojson?.type === "FeatureCollection" && Array.isArray(geojson.features)) {
                geometries = geojson.features.map((f) => f?.geometry);
            } else if (geojson?.type === "Feature") {
                geometries = [geojson.geometry];
            } else if (geojson?.type && Array.isArray(geojson.coordinates)) {
                geometries = [geojson]; // Géométrie directe, sans Feature
            } else {
                throw new ImportGeometrieError(`Format GeoJSON non supporté (type : ${geojson?.type ?? "absent"}).`);
            }

            // Format: "urn:ogc:def:crs:EPSG::2154" ou "EPSG:2154"
            const crs = geojson.crs?.properties?.name;
            const epsg = typeof crs === "string" ? crs.match(/EPSG:{1,2}(\d+)/i) : null;
            const srid = epsg ? parseInt(epsg[1], 10) : /CRS84$/i.test(crs || "") ? 4326 : null;

            const resultat = await insererLocalisation(pool, geometries, req.body.uuid_ope.trim(), srid);
            console.log("Import GeoJSON réussi :", resultat);
            repondreImportGeo(res, resultat);
        } catch (error) {
            repondreErreurImportGeo(res, error);
        } finally {
            await fs.promises.rm(filePath, { force: true }).catch(() => {});
        }
    }
);

// Enregistrement de documents liés à une référence (ref_id) dans la table files.docs
router.put("/put/table=docs", async (req, res) => {
    try {
        // Charger les champs Multer dynamiques depuis la DB
        await loadMulterFieldsConfig();
        await loadUploadFolders(); // dossiers et types (libnom_id) utilisés pour nommer les fichiers
        const multerMiddlewareDoc = createMulterMiddlewareDoc();

        // Exécuter le middleware Multer
        multerMiddlewareDoc(req, res, async (err) => {
            if (err) {
                console.error("Erreur Multer :", err);
                return res
                    .status(400)
                    .json({ success: false, message: err.message });
            }

            console.log("Body de la requête :", req.body);
            console.log(
                "Champs Multer dynamiques actifs :",
                multerFieldsConfig
            );
            console.log("Fichiers de la requête :", req.files);

            const ref_id = req.body.ref_id;
            if (!ref_id) {
                return res
                    .status(400)
                    .json({ success: false, message: "ref_id manquant" });
            }

            try {
                // Récupérer le mapping champ → type
                const typeMapping = await ExecuteQuerySitePromise(pool, {
                    query: "SELECT lib_field, lib_id as cd_type FROM files.libelles",
                });

                const fieldToType = typeMapping.rows.reduce((acc, row) => {
                    acc[row.lib_field] = row.cd_type;
                    return acc;
                }, {});

                // Préparer les fichiers à insérer
                const filesToInsert = [];

                for (const [fieldName, files] of Object.entries(req.files || {})) {
                    const docType = fieldToType[fieldName];
                    if (!docType) {
                        console.warn(
                            `Champ ${fieldName} non reconnu dans files.libelles, ignoré.`
                        );
                        continue;
                    }

                    files.forEach((file) => {
                        // Convertir le chemin absolu en chemin relatif à partir de "mnt"
                        console.log("Chemin complet du fichier :", file.path);

                        const cleanedPath = path.relative(FILES_DIR, file.path); // chemin relatif à FILES_DIR
                        console.log("Chemin relatif :", cleanedPath);

                        filesToInsert.push({
                            ref_id,
                            doc_type: docType,
                            doc_path: cleanedPath,
                        });

                        // --- AJOUT : garantir les droits 666 sur chaque fichier uploadé ---
                        try {
                            fs.chmodSync(file.path, 0o666);
                        } catch (e) {
                            console.warn(`Impossible de changer les droits du fichier ${file.path}:`, e.message);
                        }
                    });
                }

                if (filesToInsert.length === 0) {
                    return res
                        .status(400)
                        .json({
                            success: false,
                            message: "Aucun fichier valide à insérer",
                        });
                }

                // Générer et exécuter les requêtes
                const queries = filesToInsert.map((file) =>
                    generateInsertQuery("files.docs", file, false)
                );

                const results = await Promise.all(
                    queries.map((q) =>
                        ExecuteQuerySitePromise(pool, { query: q }, "insert")
                    )
                );

                return res.status(200).json({ success: true, data: results });
            } catch (err) {
                console.error(
                    "Erreur pendant l'insertion des documents :",
                    err
                );
                return res
                    .status(500)
                    .json({ success: false, message: err.message });
            }
        });
    } catch (err) {
        console.error("Erreur serveur :", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// Rattacher une commune à un site (via son espace : esp.localisations)
// Corps : { "insee": "51108" }
router.post("/commune/uuid_site=:uuid_site", authenticateToken, async (req, res) => {
    const uuidSite = req.params.uuid_site;
    const insee = String(req.body?.insee ?? "").trim();

    if (!INSEE_REGEX.test(insee)) {
        return res.status(400).json({ success: false, message: "Code INSEE invalide : " + insee + ".", code: 1 });
    }

    try {
        const result = await pool.query(
            `INSERT INTO esp.localisations (commune, espace)
             SELECT $2, s.espace FROM sitcenca.sites s WHERE s.uuid_site = $1
             RETURNING commune, espace`,
            [uuidSite, insee]
        );
        if (!result.rowCount) {
            return res.status(404).json({ success: false, message: "Site introuvable.", code: 1 });
        }
        return res.status(201).json({
            success: true,
            code: 0,
            message: "Commune " + insee + " rattachée au site.",
            data: result.rows[0],
        });
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ success: false, message: "La commune " + insee + " est déjà rattachée à ce site.", code: 1 });
        }
        if (error.code === "23503") {
            return res.status(400).json({ success: false, message: "Commune " + insee + " inconnue de la table des communes (terr.ign_commune).", code: 1 });
        }
        console.error("Erreur lors du rattachement de la commune " + insee + " au site " + uuidSite + " :", error);
        return res.status(500).json({ success: false, message: "Erreur lors du rattachement de la commune.", code: 1 });
    }
});

// Rattacher un conservateur bénévole (contact de l'annuaire) à un site
// Corps : { "uuid_ann": "…" }. Le contact reçoit au passage l'étiquette CB (Conservateur bénévole).
router.post("/conservateur/uuid_site=:uuid_site", authenticateToken, async (req, res) => {
    const uuidSite = req.params.uuid_site;
    const uuidAnn = String(req.body?.uuid_ann ?? "").trim();

    if (!uuidAnn) {
        return res.status(400).json({ success: false, message: "Aucun contact (uuid_ann) fourni.", code: 1 });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            "INSERT INTO sitcenca.conservateurs (societe, site) VALUES ($1, $2) RETURNING societe AS uuid_ann, site AS uuid_site",
            [uuidAnn, uuidSite]
        );
        await client.query(
            "INSERT INTO ann.etiquettes (annuaire, typ_etiquette) VALUES ($1, 'CB') ON CONFLICT DO NOTHING",
            [uuidAnn]
        );
        await client.query("COMMIT");
        return res.status(201).json({
            success: true,
            code: 0,
            message: "Conservateur rattaché au site.",
            data: result.rows[0],
        });
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error("Erreur rollback rattachement conservateur :", rollbackError);
        }
        if (error.code === "23505") {
            return res.status(409).json({ success: false, message: "Ce conservateur est déjà rattaché à ce site.", code: 1 });
        }
        if (error.code === "23503") {
            const message = error.constraint === "site_fk" ? "Site introuvable." : "Contact introuvable dans l'annuaire.";
            return res.status(404).json({ success: false, message, code: 1 });
        }
        console.error("Erreur lors du rattachement du conservateur " + uuidAnn + " au site " + uuidSite + " :", error);
        return res.status(500).json({ success: false, message: "Erreur lors du rattachement du conservateur.", code: 1 });
    } finally {
        client.release();
    }
});

module.exports = router;
