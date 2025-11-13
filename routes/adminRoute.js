const express = require("express");
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const {joinQuery, selectQuery, ExecuteQuerySite, distinctSiteResearch,
    executeQueryAndRespond, reset, getBilan,} = require("../fonctions/fonctionsSites.js");
const { generateFicheTravauxWord } = require("../scripts/gen_fiche_travaux.js");
const pool = require("../dbPool/poolConnect.js");
    
const { getTableColums, generateCloneQuery } = require('../fonctions/querys.js');

// Utilisateurs
router.get("/users/:mode/:cd_salarie?", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();
    mode = req.params.mode;
    const cd_salarie = req.params.cd_salarie ? req.params.cd_salarie : null;
    message = "/users/" + mode;

    if (req.params.mode == "lite") {
        SelectFields =
            "SELECT cd_salarie, \"nom complet\" as nom_complet, email, fonction, identifiant ";
        FromTable = "FROM admin.v_salaries";
    } else if (req.params.mode == "full") {
        SelectFields =
            "select cd_salarie, nom, prenom, email, statut, typ_fonction, identifiant, sal_role ";
        FromTable = "FROM admin.salaries AS sal ";
        FromTable += " ";
        where = "where sal.cd_salarie = $1;";
    }

    executeQueryAndRespond(
        pool,
        SelectFields,
        FromTable,
        where,
        cd_salarie,
        res,
        message,
        mode
    );
});

// Dupliquer un salarié
router.put("/put/table=:table/clone", (req, res) => {
    const TABLE = req.params.table;
    const INSERT_DATA = req.body; // Récupérer l'objet JSON envoyé
    console.log("Body reçu pour la duplication :", INSERT_DATA);
    const MESSAGE = "admin/put/table=" + TABLE + "/clone";
    // Tables possibles pour des différents clones. En clé le nom de la table, en valeur son schema
    const TABLES = {'salaries':'admin'};

    try {
        if (Object.keys(TABLES).includes(TABLE)) {
            
            const WORKING_TABLE = TABLES[TABLE] + "." + TABLE;
            console.log("WORKING_TABLE : " + WORKING_TABLE);

            const queryFields = getTableColums(TABLES[TABLE], TABLE);
            console.log(queryFields);

            // Première exécution de requête pour obtenir la liste des champs de la table cible
            ExecuteQuerySite(
                pool,
                { query: queryFields, message: MESSAGE },
                "select",
                ( fields, message ) => {

                    console.log("fields obtenus par la requête : ");
                    console.log(fields);

                    if (fields && fields.length > 0) {
                        // Générer un nouveau cd_salarie unique
                        const newCdSalarie = uuidv4();
                        
                        // Générer la requête de clonage avec le nouveau cd_salarie
                        const queryObject = generateCloneQuery(
                            WORKING_TABLE, 
                            fields[0]['column_name'], // 'cd_salarie'
                            fields, 
                            INSERT_DATA["cd_salarie"],
                            newCdSalarie,
                            INSERT_DATA["excludeFieldsGroups"]
                        );
                        console.log(queryObject);

                        // Deuxième exécution de requête pour cloner le salarié
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
                                        message: "Duplication réussie du salarié " + INSERT_DATA["cd_salarie"] + " dans la table " + WORKING_TABLE + ".",
                                        code: 0,
                                        data: { newId: newCdSalarie, resultats }
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
                        console.log(`Échec de la requête de récupération des colonnes à ${currentDateTime}`);
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
        console.error("Erreur lors du clonage : ", error);
        res.status(500).json({
            success: false,
            message: "Erreur interne du serveur."
        });
    }
});

module.exports = router;