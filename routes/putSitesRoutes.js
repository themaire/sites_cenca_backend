const express = require('express');
const router = express.Router();


// Fonctions et connexion à PostgreSQL
const { ExecuteQuerySite, updateEspaceSite, convertToWKT } = require('../fonctions/fonctionsSites.js'); 
const pool = require('../dbPool/poolConnect.js');

// Generateur de requetes SQL
const { generateUpdateQuery, generateInsertQuery } = require('../fonctions/querys.js'); 

const multer = require('multer');
const shapefile = require('shapefile');
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');

// Configuration de multer pour gérer l'upload de fichiers
// Configuration Multer modifiée
const multerMiddlewareZip = multer({
    dest: 'uploads/',
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
            cb(null, true);
        } else {
            cb(new Error('Format de fichier non supporté. Seuls les .zip sont acceptés.'));
        }
    }
}).fields([
    { name: 'file', maxCount: 1 },
    { name: 'type_geometry', maxCount: 1 }
]);

// Mettre à jour un site, un acte, un projet, une operation ...
router.put("/put/table=:table/uuid=:uuid", (req, res) => {
    const TABLE = req.params.table;
    const UUID = req.params.uuid; // UUID du site à mettre à jour
    const updateData = req.body; // Récupérer l'objet JSON envoyé

    try {
        if (TABLE === 'espace_site') {
            // Séparer les champs pour les tables 'espace' et 'site' afin de les insérer dans les bonnes tables
            // d'utiliser les bonnes fonctions de création de requetes update
            const espaceFields = [
                "date_crea_espace", "id_espace", "nom", "surface", 
                "carto_hab", "zh", "typ_espace", "bassin_agence", "rgpt", 
                "typ_geologie", "id_source", "id_crea", "url", "maj_admin"
            ];
            const siteFields = [
                "code", "prem_ctr", "ref_fcen", "pourc_gere", 
                "surf_actes", "url_cen", "validite", "espace", "typ_site", 
                "responsable", "date_crea_site", "id_mnhn", "modif_admin", 
                "actuel", "url_mnhn", "parties_gerees", "typ_ouverture", 
                "description_site", "sensibilite", "remq_sensibilite", "ref_public"
            ];

            const espaceData = {};
            const siteData = {};

            Object.keys(updateData).forEach(key => {
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
            const espaceQuery = generateUpdateQuery('esp.espaces', updateData.uuid_espace, espaceData);
            const siteQuery = generateUpdateQuery('sitcenca.sites', UUID, siteData);
            
            updateEspaceSite(pool, res, espaceQuery, siteQuery);
            
        } else if (['projets', 'operations', 'objectifs'].includes(TABLE)) {

            console.log("updateData");
            console.log(updateData);

            const queryObject = generateUpdateQuery("opegerer." + TABLE, UUID, updateData);
            console.log(queryObject);

            ExecuteQuerySite(
                pool,
                { query: queryObject, message: "sites/put/table=" + TABLE + "/uuid" },
                'update',
                ( resultats, message ) => {
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader("Content-Type", "application/json; charset=utf-8");

                    if (message === 'ok') {
                        res.status(200).json({
                            success: true,
                            message: "Mise à jour réussie sur la table " + TABLE + ".",
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
        } else if (TABLE in ['acte']) {

            const queryObject = generateUpdateQuery(TABLE, UUID, updateData);
            console.log(queryObject);

            ExecuteQuerySite(
                pool,
                { query: queryObject, message: "sites/put/table=" + TABLE + "/uuid" },
                ( resultats, message ) => {
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader("Content-Type", "application/json; charset=utf-8");

                    if (resultats && resultats.length > 0) {
                        res.status(200).json({
                            success: true,
                            message: "Mise à jour réussie.",
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
            res.status(400).json({
                success: false,
                message: "Table invalide."
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

// Ajouter un site, un acte...
router.put("/put/table=:table/insert", (req, res) => {
    const TABLE = req.params.table;
    const INSERT_DATA = req.body; // Récupérer l'objet JSON envoyé
    const MESSAGE = "sites/put/table=" + TABLE + "/insert";
    // Tables possibles pour des differents insert. En clé le nom de la table, en valeur son schema
    const TABLES = {'sites':'sitcenca', 'actes_mfu':'sitcenca', 'projets':'opegerer', 'operations':'opegerer', 'objectifs':'opegerer'};

    try {

        if (Object.keys(TABLES).includes(TABLE)) {
            
            const WORKING_TABLE = TABLES[TABLE] + "." + TABLE;
            console.log("WORKING_TABLE : " + WORKING_TABLE);

            const queryObject = generateInsertQuery(WORKING_TABLE, INSERT_DATA, createUUID = false);
            console.log(queryObject);

            ExecuteQuerySite(
                pool,
                { query: queryObject, message: MESSAGE },
                "insert",
                ( resultats, message ) => {
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader("Content-Type", "application/json; charset=utf-8");

                    if (message === 'ok') {
                        res.status(201).json({
                            success: true,
                            message: "Insert réussie.",
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

// Nouvelle route pour gérer l'upload du fichier shapefile avec des données supplémentaires
router.post(
    //// Paramètres
    // 1 - La route
    '/put/ope_shapefile', 

    // 2 - Multer
    multerMiddlewareZip,

    // 3  - Middleware de validation
    (req, res, next) => {
        console.log('');
        console.log('Requête reçue pour le traitement d\'un shapefile');
        // console.log('Headers:', req.headers);
        // console.log('Content-Type:', req.headers['content-type']);
        console.log('Body raw:', req.body);
        console.log('Files:', req.files);
        // console.log('Fields:', req.fields);()

        if (!req.body.type_geometry && !req.fields?.type_geometry) {
            return res.status(400).json({
                success: false,
                message: "Le type de géométrie est requis"
            });
        }
        next();
    },

    // Handler principal
    async (req, res) => {
        let filePath;

        try {
            // Vérification du fichier
            if (!req.files?.file?.[0]) {
                return res.status(400).json({
                    success: false,
                    message: "Aucun fichier n'a été envoyé"
                });
            }

            filePath = req.files.file[0].path;
            const extractPath = path.join(__dirname, '../uploads/extracted');
            const typeGeometry = req.body.type_geometry || req.fields.type_geometry;
            const uuid_ope = req.body.uuid_ope || req.fields.uuid_ope;
            
            console.log('Chemin du fichier : ', filePath);
            console.log('Fichier reçu : ', req.files.file[0].originalname);
            console.log('Type de fichier : ', req.files.file[0].mimetype);
            console.log('Type de géométrie : ', typeGeometry);
            console.log('Chemin d\'extraction : ', extractPath);
            console.log('');
            
            
            // Extraire le zip et renommer les fichiers extraits
            // Extraire
            await fs.createReadStream(filePath)
                .pipe(unzipper.Extract({ path: extractPath }))
                .promise();
            const files = await fs.promises.readdir(extractPath);
            
            // Renommer
            for (const file of files) {
                const extension = path.extname(file);
                const oldPath = path.join(extractPath, file);
                const newPath = path.join(extractPath, `shapefile${extension}`);
                
                await fs.promises.rename(oldPath, newPath);
                console.log(`Fichier renommé: ${file} -> shapefile${extension}`);
            }

            // Lire le fichier shapefile
            const shpFilePath = path.join(extractPath, 'shapefile.shp');
            const dbfFilePath = path.join(extractPath, 'shapefile.dbf');

            let features = [];
            await shapefile.open(shpFilePath, dbfFilePath)
                .then(source => source.read()
                    .then(function log(result) {
                        if (result.done) {
                            if (features.length > 1) {
                                throw new Error(`Plus d'une géométrie dans le fichier shapefile (${features.length} trouvées au lieu de 1 maximum)`);
                            }
                            return;
                        }
                        features.push(result.value);
                        return source.read().then(log);
                    })
                )
                .catch(error => {
                    throw new Error(error.message);
                });
                
            if (features.length === 0) {
                throw new Error('Aucune géométrie trouvée dans le fichier shapefile');
            }

            // Debug
            console.log('Géométrie extraite:', features[0]);

            // Insérer le polygone dans la base de données
            for (const feature of features) { // Boucle meme si une seule geometrie dans la liste
                const properties = { ...feature.properties, 
                                    wkt: convertToWKT(feature.geometry.coordinates), 
                                    type_geometry: typeGeometry, 
                                    ref_uuid_ope: uuid_ope,
                                 };

                // Créer l'objet de requête avec la géométrie
                const queryObject = {
                    text: `INSERT INTO opegerer.localisation_tvx (loc_poly, ref_uuid_ope ) VALUES (ST_GeomFromEWKT($1), $2);`,
                    values: [properties.wkt, properties.ref_uuid_ope]
                };
                console.log('Requête:', queryObject);

                // Exécuter la requête
                await ExecuteQuerySite(
                    pool, 
                    {query: queryObject, message: 'insert polygon from shapefile to opegerer.localisation_tvx'},
                    'insert',
                    ( resultats, message ) => {
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader("Content-Type", "application/json; charset=utf-8");

                    if (message === 'ok') {
                        // Réponse en cas de succès
                        res.status(200).json({
                            success: true,
                            message: "Polygone inseré avec succès.",
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
                });
            }

        } catch (error) {
            // Log détaillé de l'erreur
            console.error("Erreur détaillée:", error);
            
            // Réponse appropriée selon le type d'erreur
            res.status(error.message.includes('géométrie') ? 400 : 500).json({
                success: false,
                message: error.message
            });
        } finally {
            // Nettoyage des fichiers temporaires
            if (filePath) {
                await fs.promises.rm(filePath, { force: true });
            }
        }
    }
);
module.exports = router;
