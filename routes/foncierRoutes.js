const express = require('express');
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const { joinQuery, selectQuery, ExecuteQuerySite, distinctSiteResearch, executeQueryAndRespond, reset } = require('../fonctions/fonctionsSites.js'); 
const pool = require('../dbPool/poolConnect.js');

// Generateur de requetes SQL
const { generateUpdateQuery, generateInsertQuery } = require('../fonctions/querys.js'); 

// Demandes d'extractions foncières, soit toutes soit une avec son ID
router.get("/foncier/extraction=:id", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();

    const ID = req.params.id;
    const MESSAGE = "sites/foncier/extraction";
    
    SelectFields =  "SELECT ";
    SelectFields += 'ext_id, ref_identifiant, sal.prenom || \' \' || sal.nom as "nom_complet", ext_code_site, ext_description, TO_CHAR(ext_date, \'DD/MM/YYYY\') AS date ';
    FromTable =     "FROM foncier.extractions ";
    FromTable +=    'LEFT JOIN admin.salaries sal ON extractions.ref_identifiant = sal.identifiant ';

    if (ID !== "null") {
        where = "where ext_id = $1";
    }

    executeQueryAndRespond(pool, SelectFields, FromTable, where, ID, res, MESSAGE)
});

// Obtenir les parcelles d'extractions foncières
router.get("/foncier/parc_extraction=:id", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();

    const ID = req.params.id;
    const MESSAGE = "sites/foncier/parcelles_extraction";
    
    SelectFields =  "SELECT ";
    SelectFields += 'parex_id, ref_ext_id, parex_insee, parex_section, parex_numero, parex_prefixe ';
    FromTable =     "FROM foncier.parc_extraction ";
    where = "where ref_ext_id = $1";

    executeQueryAndRespond(pool, SelectFields, FromTable, where, ID, res, message)
});

// Ajouter une une extraction foncière ou une parcelle
router.put("/foncier/put/table=:table/insert", (req, res) => {
    const TABLE = req.params.table;
    const INSERT_DATA = req.body; // Récupérer l'objet JSON envoyé
    const MESSAGE = "sites/put/table=" + TABLE + "/insert";
    // Tables possibles pour des differents insert. En clé le nom de la table, en valeur le schema
    const TABLES = {'extractions':'foncier'};

    try {

        if (Object.keys(TABLES).includes(TABLE)) {
            
            const WORKING_TABLE = TABLES[TABLE] + "." + TABLE;
            console.log("WORKING_TABLE : " + WORKING_TABLE);

            const queryObject = generateInsertQuery(WORKING_TABLE, INSERT_DATA, false); // false pour ne pas utiliser gen_random_uuid()
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
            message: "Erreur interne du serveur. La base de données est accessible?"
        });
    }
});

module.exports = router;
