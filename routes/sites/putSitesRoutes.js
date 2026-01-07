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
    convertToWKT,
    detectShapefileGeometryType,
    extractZipFile,
} = require("../../fonctions/fonctionsSites.js");
const pool = require("../../dbPool/poolConnect.js");

// Generateur de requetes SQL
const { generateUpdateQuery, generateInsertQuery, generateCloneQuery, getTableColums, generateCloneCheckboxQuery } = require('../../fonctions/querys.js'); 

const multer = require("multer");
const shapefile = require("shapefile");
const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");
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

async function loadUploadFolders() {
    const rows = await ExecuteQuerySitePromise(pool, {
        query: "SELECT lib_path, lib_field FROM files.libelles",
    });

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
        // Récupération du dossier correspondant au nom
        const folderName = uploadFolders[file.fieldname] || "autres";
        const folder = path.join(FILES_DIR, folderName);

        // Changer temporairement le umask à 002
        const oldUmask = process.umask(0o002);
        fs.mkdirSync(folder, { recursive: true });
        process.umask(oldUmask);

        cb(null, folder);
    },
    filename: (req, file, cb) => {
        const refId = req.body.ref_id;
        const now = new Date();
        const date = `${now.getFullYear()}-${
            now.getMonth() + 1
        }-${now.getDate()}-${now.getMilliseconds()}`;
        const extension = path.extname(file.originalname).toLowerCase();

        const filename = `doc_${refId}_${date}${extension}`;
        cb(null, filename);
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
    console.log(" Tentative d’upload:", file.originalname, ">", file.mimetype);
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
// Configuration de multer pour gérer l'upload de fichiers
// Configuration Multer modifiée
const multerMiddlewareZip = multer({
    dest: "uploads/",
    fileFilter: (req, file, cb) => {
        if (
            file.mimetype === "application/zip" ||
            file.originalname.endsWith(".zip")
        ) {
            cb(null, true);
        } else {
            cb(
                new Error(
                    "Format de fichier non supporté. Seuls les .zip sont acceptés."
                )
            );
        }
    },
}).fields([
    { name: "file", maxCount: 1 },
    { name: "type_geometry", maxCount: 1 },
]);

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

            // Générer les requêtes UPDATE pour chaque table
            // Ne PAS oublier d'ajouter l'UUID de la bonne table
            const espaceQuery = generateUpdateQuery(
                "esp.espaces",
                updateData.uuid_espace,
                espaceData
            );
            const siteQuery = generateUpdateQuery(
                "sitcenca.sites",
                UUID,
                siteData
            );

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
                            message: "Mise à jour réussie (" + TABLE + ").", // sera viible dans le snackbar
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
        } else if (TABLE in ["acte"]) {
            const queryObject = generateUpdateQuery(TABLE, UUID, updateData);
            console.log(queryObject);

            ExecuteQuerySite(
                pool,
                {
                    query: queryObject,
                    message: "sites/put/table=" + TABLE + "/uuid",
                },
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
                updateData
            );
            console.log("Query de pmfu : " + queryObject);
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

// Ajouter un site, un acte, une operation ...
router.put("/put/table=:table/insert", (req, res) => {
    // console.log("La requête : ", req);
    const TABLE = req.params.table;
    const INSERT_DATA = req.body; // Récupérer l'objet JSON envoyé
    console.log("INSERT_DATA de la requête : ", INSERT_DATA);
    
    const MESSAGE = "sites/put/table=" + TABLE + "/insert";
    // Tables possibles pour des differents insert. En clé le nom de la table, en valeur son schema
    const TABLES = {
        sites: "sitcenca",
        actes_mfu: "sitcenca",
        projets_mfu: "sitcenca",
        pmfu_docs: "sitcenca",
        projets: "opegerer",
        operations: "opegerer",
        objectifs: "opegerer",
        operation_financeurs: "opegerer",
        operation_animaux: "opegerer",
    };


    try {
        if (TABLE === "projets_mfu") {
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
        } else if (Object.keys(TABLES).includes(TABLE)) {
            const WORKING_TABLE = TABLES[TABLE] + "." + TABLE;
            console.log("WORKING_TABLE : " + WORKING_TABLE);

            const queryObject = generateInsertQuery(
                WORKING_TABLE,
                INSERT_DATA,
                (createUUID = false)
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
                        console.log(queryObject.text);
                        console.log(queryObject.values);
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
    const TABLES = {'projets':'opegerer', 'operations':'opegerer'};

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
                ( fields, message ) => {

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
                            ( resultats, message ) => {
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

// Dupliquer un projet complet ou une operation.
// DOUBLON??
// router.put("/put/table=:table/clone", (req, res) => {
//     const TABLE = req.params.table;
//     const INSERT_DATA = req.body; // Récupérer l'objet JSON envoyé
//     console.log("Body reçu pour la duplication :", INSERT_DATA);
//     const MESSAGE = "sites/put/table=" + TABLE + "/clone";
//     // Tables possibles pour des differents insert. En clé le nom de la table, en valeur son schema
//     const TABLES = {'projets':'opegerer', 'operations':'opegerer'};

//     try {
//         if (Object.keys(TABLES).includes(TABLE)) {
            
//             const WORKING_TABLE = TABLES[TABLE] + "." + TABLE;
//             console.log("WORKING_TABLE : " + WORKING_TABLE);

//             const queryFields = getTableColums(TABLES[TABLE], TABLE);
//             console.log(queryFields);

//             // Premiere execution de requete pour obtnenir la liste des champs de la table cible
//             ExecuteQuerySite(
//                 pool,
//                 { query: queryFields, message: MESSAGE },
//                 "select",
//                 ( fields, message ) => {

//                     console.log("fields obtenus par la requête : ");
//                     console.log(fields);

//                     if (fields && fields.length > 0) { // Si on a bien des champs retournés
//                         // par exemple :
//                         //  [
//                         //   { column_name: 'uuid_ope' },
//                         //   { column_name: 'code' },
//                         //   { column_name: 'titre' },

//                         // Générer la requête d'insertion avec les bons champs
//                         const newUUID = uuidv4();
//                         const queryObject = generateCloneQuery(WORKING_TABLE, fields[0]['column_name'], fields, INSERT_DATA["id"], newUUID, INSERT_DATA["excludeFieldsGroups"]);
//                         console.log(queryObject);

//                         // Deuxième execution de requete pour cloner cette fois ci l'élement souhaité
//                         ExecuteQuerySite(
//                             pool,
//                             { query: queryObject, message: MESSAGE },
//                             "insert",
//                             ( resultats, message ) => {
//                                 res.setHeader("Access-Control-Allow-Origin", "*");
//                                 res.setHeader("Content-Type", "application/json; charset=utf-8");

//                                 if (message === 'ok') { // le message est ok est dans le cas hors d'un select
//                                     if (TABLE == 'operations') {
//                                         // Si on clone une operation, on doit aussi cloner ses financeurs et animaux liés
//                                         const queryCloneFinanceurs = generateCloneCheckboxQuery('opegerer.operation_financeurs', INSERT_DATA["id"], newUUID);
//                                         ExecuteQuerySite(
//                                             pool,
//                                             { query: queryCloneFinanceurs, message: MESSAGE },
//                                             "insert",
//                                             (resultats, message) => {
//                                                 if (message === 'ok') {
//                                                     console.log("Financeurs clonés avec succès.");
//                                                 } else {
//                                                     console.error("Erreur lors du clonage des financeurs.");
//                                                 }
//                                             }
//                                         );

//                                         const queryCloneAnimaux = generateCloneCheckboxQuery('opegerer.operation_animaux', INSERT_DATA["id"], newUUID);
//                                         ExecuteQuerySite(
//                                             pool,
//                                             { query: queryCloneAnimaux, message: MESSAGE },
//                                             "insert",
//                                             (resultats, message) => {
//                                                 if (message === 'ok') {
//                                                     console.log("Animaux clonés avec succès.");
//                                                 } else {
//                                                     console.error("Erreur lors du clonage des animaux.");
//                                                 }
//                                             }
//                                         );
//                                     }
//                                     res.status(201).json({
//                                         success: true,
//                                         message: "Duplication réussie de la ligne " + INSERT_DATA["id"] + " dans la table " + WORKING_TABLE + ".",
//                                         code: 0,
//                                         data: resultats
//                                     });
//                                     console.log("message : " + message);
//                                     console.log("resultats : " + resultats);
//                                 } else {
//                                     const currentDateTime = new Date().toISOString();
//                                     console.log(`Échec de la requête à ${currentDateTime}`);
//                                     console.log(queryObject.text);
//                                     console.log(queryObject.values);
//                                     res.status(500).json({
//                                         success: false,
//                                         message: "Erreur, la requête s'est mal exécutée."
//                                     });
//                                 }
//                             }
//                         );


//                     } else {
//                         const currentDateTime = new Date().toISOString();
//                         console.log(`Échec de la requête de récupèration des colonnes à ${currentDateTime}`);
//                         console.log("Message de la fonction callback : " + message);
//                         console.log(queryFields.text);
//                         console.log(queryFields.values);
//                         res.status(500).json({
//                             success: false,
//                             message: "Erreur, la requête s'est mal exécutée."
//                         });
//                     }
//                 }
//             );


            
//         } else {
//             const BAD_MESSAGE = "Table " + TABLE + " inconnue dans la liste des tables connues.";
//             console.log(BAD_MESSAGE);
//             res.status(400).json({
//                 success: false,
//                 message: BAD_MESSAGE
//             });
//         }
//     } catch (error) {
//         console.error("Erreur lors de la mise à jour : ", error);
//         res.status(500).json({
//             success: false,
//             message: "Erreur interne du serveur."
//         });
//     }
// });

// Nouvelle route pour gérer l'upload du fichier shapefile avec des données supplémentaires
router.post(
    //// Paramètres
    // 1 - La route
    "/put/ope_shapefile",

    // 2 - Multer
    multerMiddlewareZip,

    // 3  - Middleware de validation
    // pour vérifier si le type de géométrie est présent
    // Sinon, renvoyer une erreur 400 et on ne fait pas la suite (le next() n'est pas appelé)
    (req, res, next) => {
        console.log("");
        console.log("Requête reçue pour le traitement d'un shapefile");
        // console.log('Headers:', req.headers);
        // console.log('Content-Type:', req.headers['content-type']);
        console.log("Body raw:", req.body);
        console.log("Files:", req.files);
        // console.log('Fields:', req.fields);()

        // Bien vérifier si le type de géométrie est présent
        // if (!req.body.type_geometry && !req.fields?.type_geometry) {
        //     return res.status(400).json({
        //         success: false,
        //         message: "Le type de géométrie est requis"
        //     });
        // }
        // Vérification si le fichier est présent
        if (!req.files?.file?.[0]) {
            return res.status(400).json({
                success: false,
                message: "Aucun fichier n'a été envoyé",
            });
        }
        next();
    },

    // Handler principal
    async (req, res) => {
        try {
            // Variables envoyées par le client
            // Fichier reçu
            const filePath = req.files.file[0].path; // Chemin du fichier reçu sur le serveur (a effacer apres décompression)
            const originalname = req.files.file[0].originalname; // Nom du fichier reçu
            const fileName = originalname.split(".").slice(0, -1).join("."); // Nom du fichier reçu avec l'extension

            const uploadPath = path.join(__dirname, "../../uploads");
            const extractPath = path.join(uploadPath, "extracted"); // Où les zip sont mis les zip extraits
            // const extractedFolder = path.join(extractPath, fileName); // Chemin du zip extrait

            if (!fs.existsSync(uploadPath)) {
                fs.mkdirSync(uploadPath, { recursive: true });
            }
            if (!fs.existsSync(extractPath)) {
                fs.mkdirSync(extractPath, { recursive: true });
            }

            let workingPath = "";
            let zippedFolder = "";

            // Infos envoyées par le client
            let typeGeometry =
                req.body.type_geometry || req.fields.type_geometry;
            const uuid_ope = req.body.uuid_ope || req.fields.uuid_ope;

            // Debug
            console.log(
                "Chemin du fichier reçu par le client : " +
                    filePath +
                    ". De type : " +
                    req.files.file[0].mimetype
            );
            console.log("Vrai nom du fichier reçu : ", originalname);
            console.log(
                "Vrai nom du fichier reçu (sans l'extension) : ",
                fileName
            );
            console.log("Type de géométrie déclaré : ", typeGeometry);
            console.log("Où les zip sont mis les zip extraits : ", extractPath);
            // console.log('Chemin du zip extrait : ', extractedFolder);
            console.log("");

            // Utiliser await pour récupérer la valeur retournée par la fonction extractZipFile
            zippedFolder = await extractZipFile(filePath, extractPath);
            console.log("Fichier zip extrait avec succès");

            if (zippedFolder != "") {
                // Si la personne a zippé un dossier
                workingPath = path.join(extractPath, zippedFolder);
            } else if (zippedFolder == "") {
                // Si la personne a zippé les fichiers du shapefile directement
                workingPath = extractPath;
            }
            console.log("Chemin d'extraction : ", workingPath);

            // Supprimer le répertoire de destination s'il existe et n'est pas vide
            // const destPath = '/home/nico/Documents/sites_cenca/node_pgsql/uploads/extracted/shapefile';
            // if (fs.existsSync(destPath)) {
            //     await fs.promises.rm(destPath, { recursive: true, force: true });
            // }

            // Renommer
            const files = await fs.promises.readdir(workingPath); // Obtenir la liste des fichiers extraits
            console.log("Fichiers extraits:", files);
            for (const file of files) {
                const extension = path.extname(file);
                const oldPath = path.join(workingPath, file);
                const newPath = path.join(workingPath, `shapefile${extension}`);

                await fs.promises.rename(oldPath, newPath);
                console.log(
                    `Fichier renommé: ${file} -> shapefile${extension}`
                );
            }

            // exit(0);
            // await fs.promises.rm(workingPath, { recursive: true });

            // Lire le fichier shapefile
            const shpFile = path.join(workingPath, "shapefile.shp");
            const dbfFile = path.join(workingPath, "shapefile.dbf");

            // Test de la nature du shapefile
            typeGeometry = await detectShapefileGeometryType(shpFile, dbfFile);
            console.log("Type de géométrie détecté :", typeGeometry);

            // Lecture et test d'ouverture puis du contenu du shapefile
            let features = [];
            await shapefile
                .open(shpFile, dbfFile)
                .then((source) =>
                    source.read().then(function log(result) {
                        if (result.done) {
                            // Présence d'une couche de polygone(s) dans le shapefile
                            if (
                                typeof typeGeometry === "string" &&
                                typeGeometry.trim().endsWith("POLYGON") &&
                                features.length > 1
                            ) {
                                throw new Error(
                                    `Plus d'une géométrie dans le fichier shapefile (${features.length} trouvées au lieu de 1 maximum).`
                                );
                            }
                            return;
                        }
                        features.push(result.value);
                        return source.read().then(log);
                    })
                )
                .catch((error) => {
                    // Log détaillé de l'erreur en cas de dépassement de 1 géométrie
                    throw new Error(error.message);
                });

            if (features.length === 0) {
                throw new Error(
                    "Aucune géométrie trouvée dans le fichier shapefile"
                );
            }

            let insertResults = [];
            let insertErrors = [];

            // Insérer le polygone dans la base de données
            for (let i = 0; i < features.length; i++) {
                // Boucle meme si une seule geometrie dans la liste
                // Convertir les coordonnées en WKT
                WKTData = convertToWKT(
                    features[i].geometry.coordinates,
                    typeGeometry
                );

                geomColumn = "";
                // Détermination de la colonne de géométrie dans la table opegerer.localisations
                if (WKTData.type.trim().endsWith("POLYGON")) {
                    geomColumn = "loc_poly";
                } else if (WKTData.type == "POINT") {
                    geomColumn = "loc_point";
                } else if (WKTData.type == "LINESTRING") {
                    geomColumn = "loc_line";
                } else {
                    geomColumn = "";
                }
                console.log(`Type de la géométrie [${i}]:`, WKTData.type);
                console.log(`Colonne de la géométrie [${i}]:`, geomColumn);
                console.log(`WKT de la géométrie [${i}]:`, WKTData.EWKT);

                const properties = {
                    ...features[i].properties,
                    wkt: WKTData.EWKT,
                    type_geometry: typeGeometry,
                    ref_uuid_ope: uuid_ope,
                };

                // Créer l'objet de requête avec la géométrie
                const queryObject = {
                    text: `INSERT INTO opegerer.localisations (${geomColumn}, ref_uuid_ope) VALUES (ST_GeomFromEWKT($1), $2);`,
                    values: [properties.wkt, properties.ref_uuid_ope],
                };
                console.log("Requête:", queryObject);

                try {
                    // Exécuter la requête
                    await ExecuteQuerySite(
                        pool,
                        {
                            query: queryObject,
                            message:
                                "insert polygon from shapefile to opegerer.localisation_tvx",
                        },
                        "insert",
                        (resultats, message) => {
                            if (message === "ok") {
                                insertResults.push({
                                    success: true,
                                    type: WKTData.type,
                                    data: resultats,
                                });
                            } else {
                                insertErrors.push({ success: false, message });
                            }
                        }
                    );
                } catch (e) {
                    insertErrors.push({ success: false, message: e.message });
                }
            }

            // Après la boucle, une seule réponse HTTP
            if (insertErrors.length === 0) {
                res.status(200).json({
                    success: true,
                    message: `${insertResults.length} géométrie(s) importée(s) avec succès.`,
                    data: insertResults,
                });
            } else {
                res.status(500).json({
                    success: false,
                    message: "Erreur(s) lors de l'import.",
                    errors: insertErrors,
                });
            }
        } catch (error) {
            // Log détaillé de l'erreur
            console.error("Erreur détaillée:", error);

            // Réponse appropriée selon le type d'erreur
            res.status(error.message.includes("géométrie") ? 400 : 500).json({
                success: false,
                message: error.message,
            });
        } finally {
            // Nettoyage des fichiers temporaires
            // if (filePath) {
            //     await fs.promises.rm(workingPath, { force: true });
            // }

            const cleanUpFolder = path.join(__dirname, "../../uploads/extracted");
            try {
                const things = await fs.promises.readdir(cleanUpFolder);
                for (const thing of things) {
                    await fs.promises.rm(path.join(cleanUpFolder, thing), {
                        recursive: true,
                        force: true,
                    });
                }
            } catch (cleanupError) {
                console.error(
                    "Erreur lors du nettoyage des fichiers temporaires:",
                    cleanupError
                );
            }
        }
    }
);

router.put("/put/table=docs", async (req, res) => {
    try {
        // Charger les champs Multer dynamiques depuis la DB
        await loadMulterFieldsConfig();
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

                for (const [fieldName, files] of Object.entries( req.files || {} )) {
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

                        const cleanedPath = file.path.split('/').slice(-2).join('/'); // garde les deux derniers segments
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
                    "Erreur pendant l’insertion des documents :",
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

module.exports = router;
