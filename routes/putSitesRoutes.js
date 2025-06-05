const express = require('express');
const router = express.Router();


// Fonctions et connexion à PostgreSQL
const { ExecuteQuerySite, updateEspaceSite, convertToWKT, detectShapefileGeometryType, extractZipFile } = require('../fonctions/fonctionsSites.js'); 
const pool = require('../dbPool/poolConnect.js');

// Generateur de requetes SQL
const { generateUpdateQuery, generateInsertQuery } = require('../fonctions/querys.js'); 

const multer = require('multer');
const shapefile = require('shapefile');
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const { exit } = require('process');

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
                            message: "Mise à jour réussie (" + TABLE + ").", // sera viible dans le snackbar
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

// Ajouter un site, un acte, une operation ...
router.put("/put/table=:table/insert", (req, res) => {
    const TABLE = req.params.table;
    const INSERT_DATA = req.body; // Récupérer l'objet JSON envoyé
    const MESSAGE = "sites/put/table=" + TABLE + "/insert";
    // Tables possibles pour des differents insert. En clé le nom de la table, en valeur son schema
    const TABLES = {'sites':'sitcenca', 'actes_mfu':'sitcenca', 'projets':'opegerer', 'operations':'opegerer', 'objectifs':'opegerer', 'operation_financeurs':'opegerer', 'operation_animaux':'opegerer'};

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
    // pour vérifier si le type de géométrie est présent
    // Sinon, renvoyer une erreur 400 et on ne fait pas la suite (le next() n'est pas appelé)
    (req, res, next) => {
        console.log('');
        console.log('Requête reçue pour le traitement d\'un shapefile');
        // console.log('Headers:', req.headers);
        // console.log('Content-Type:', req.headers['content-type']);
        console.log('Body raw:', req.body);
        console.log('Files:', req.files);
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
                message: "Aucun fichier n'a été envoyé"
            });
        }
        next();
    },

    // Handler principal
    async (req, res) => {
        let filePath;

        try {
            // Variables envoyées par le client
            // Fichier reçu
            const filePath = req.files.file[0].path; // Chemin du fichier reçu sur le serveur (a effacer apres décompression)
            const originalname = req.files.file[0].originalname; // Nom du fichier reçu
            const fileName = originalname.split('.').slice(0, -1).join('.'); // Nom du fichier reçu avec l'extension

            const extractPath = path.join(__dirname, '../uploads/extracted'); // Où les zip sont mis les zip extraits
            // const extractedFolder = path.join(extractPath, fileName); // Chemin du zip extrait
            let workingPath = '';
            let zippedFolder = '';

            // Infos envoyées par le client
            let typeGeometry = req.body.type_geometry || req.fields.type_geometry;
            const uuid_ope = req.body.uuid_ope || req.fields.uuid_ope;
            
            // Debug
            console.log('Chemin du fichier reçu par le client : ' + filePath + '. De type : ' + req.files.file[0].mimetype);
            console.log('Vrai nom du fichier reçu : ', originalname);
            console.log("Vrai nom du fichier reçu (sans l'extension) : ", fileName);
            console.log('Type de géométrie déclaré : ', typeGeometry);
            console.log('Où les zip sont mis les zip extraits : ', extractPath);
            // console.log('Chemin du zip extrait : ', extractedFolder);
            console.log('');
            
            // Utiliser await pour récupérer la valeur retournée par la fonction extractZipFile
            zippedFolder = await extractZipFile(filePath, extractPath);
            console.log('Fichier zip extrait avec succès');

            if (zippedFolder != '') {
                // Si la personne a zippé un dossier
                workingPath = path.join(extractPath, zippedFolder);
            } else if (zippedFolder == '') {
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
            console.log('Fichiers extraits:', files);
            for (const file of files) {
                    const extension = path.extname(file);
                    const oldPath = path.join(workingPath, file);
                    const newPath = path.join(workingPath, `shapefile${extension}`);
                
                    await fs.promises.rename(oldPath, newPath);
                    console.log(`Fichier renommé: ${file} -> shapefile${extension}`);
                }
            
            // exit(0);
            // await fs.promises.rm(workingPath, { recursive: true });

            // Lire le fichier shapefile
            const shpFile = path.join(workingPath, 'shapefile.shp');
            const dbfFile = path.join(workingPath, 'shapefile.dbf');

            // Test de la nature du shapefile
            typeGeometry = await detectShapefileGeometryType(shpFile, dbfFile);
            console.log('Type de géométrie détecté :', typeGeometry);

            // Lecture et test d'ouverture puis du contenu du shapefile
            let features = [];
            await shapefile.open(shpFile, dbfFile)
                .then(source => source.read()
                    .then(function log(result) {
                        if (result.done) {
                            // Présence d'une couche de polygone(s) dans le shapefile
                            if (typeof typeGeometry === 'string' && typeGeometry.trim().endsWith('POLYGON') && features.length > 1) {
                                throw new Error(`Plus d'une géométrie dans le fichier shapefile (${features.length} trouvées au lieu de 1 maximum).`);
                            }
                            return;
                        }
                        features.push(result.value);
                        return source.read().then(log);
                    })
                )
                .catch(error => {
                    // Log détaillé de l'erreur en cas de dépassement de 1 géométrie
                    throw new Error(error.message);
                });
                
            if (features.length === 0) {
                throw new Error('Aucune géométrie trouvée dans le fichier shapefile');
            }

            let insertResults = [];
            let insertErrors = [];

            // Insérer le polygone dans la base de données
            for (let i = 0; i < features.length; i++) { // Boucle meme si une seule geometrie dans la liste
                // Convertir les coordonnées en WKT
                WKTData = convertToWKT(features[i].geometry.coordinates, typeGeometry);

                geomColumn = '';
                // Détermination de la colonne de géométrie dans la table opegerer.localisations
                if (WKTData.type.trim().endsWith('POLYGON')) {
                    geomColumn = 'loc_poly';
                } else if (WKTData.type == 'POINT') {
                    geomColumn = 'loc_point';
                } else if (WKTData.type == 'LINESTRING') {
                    geomColumn = 'loc_line';
                } else {
                    geomColumn = '';
                }
                console.log(`Type de la géométrie [${i}]:`, WKTData.type);
                console.log(`Colonne de la géométrie [${i}]:`, geomColumn);
                console.log(`WKT de la géométrie [${i}]:`, WKTData.EWKT);

                const properties = { ...features[i].properties, 
                                    wkt: WKTData.EWKT,
                                    type_geometry: typeGeometry, 
                                    ref_uuid_ope: uuid_ope,
                                    };

                // Créer l'objet de requête avec la géométrie
                const queryObject = {
                    text: `INSERT INTO opegerer.localisations (${geomColumn}, ref_uuid_ope) VALUES (ST_GeomFromEWKT($1), $2);`,
                    values: [properties.wkt, properties.ref_uuid_ope]
                };
                console.log('Requête:', queryObject);

                try {
                    // Exécuter la requête
                    await ExecuteQuerySite(
                        pool, 
                        {query: queryObject, message: 'insert polygon from shapefile to opegerer.localisation_tvx'},
                        'insert',
                        (resultats, message) => {
                            if (message === 'ok') {
                                insertResults.push({ success: true, type: WKTData.type, data: resultats });
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
                    data: insertResults
                });
            } else {
                res.status(500).json({
                    success: false,
                    message: "Erreur(s) lors de l'import.",
                    errors: insertErrors
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
            // if (filePath) {
            //     await fs.promises.rm(workingPath, { force: true });
            // }
            
            const cleanUpFolder = path.join(__dirname, '../uploads/extracted');
            try {
                const things = await fs.promises.readdir(cleanUpFolder);
                for (const thing of things) {
                    await fs.promises.rm(path.join(cleanUpFolder, thing), { recursive: true, force: true });
                }
            } catch (cleanupError) {
                console.error("Erreur lors du nettoyage des fichiers temporaires:", cleanupError);
            }
        }
    }
);
module.exports = router;
