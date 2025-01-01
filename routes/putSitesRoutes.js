const express = require('express');
const router = express.Router();


// Fonctions et connexion à PostgreSQL
const { ExecuteQuerySite, updateEspaceSite } = require('../fonctions/fonctionsSites.js'); 
const pool = require('../dbPool/poolConnect.js');

// Generateur de requetes SQL
const { generateUpdateQuery, generateInsertQuery } = require('../fonctions/querys.js'); 

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

module.exports = router;
