const express = require("express");
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const {joinQuery, selectQuery, ExecuteQuerySite, distinctSiteResearch,
    executeQueryAndRespond, reset, getBilan,} = require("../../fonctions/fonctionsSites.js");
const { generateFicheTravauxWord } = require("../../scripts/gen_fiche_travaux.js");
const pool = require("../../dbPool/poolConnect.js");
    
const { generateUpdateQuery, getTableColums, generateCloneQuery } = require('../../fonctions/querys.js');
const { handleDelete } = require('../../fonctions/routeHandlers.js');

// Récupérer des utilisateurs ( un ou plusieurs )
router.get("/users/:mode/:cd_salarie?", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();
    mode = req.params.mode;
    const cd_salarie = req.params.cd_salarie ? req.params.cd_salarie : null;
    message = "/users/" + mode;

    if (req.params.mode == "lite") {
        SelectFields =
            "SELECT cd_salarie, \"nom complet\" as nom_complet, email, fonction, identifiant ";
        FromTable = "FROM admin.v_salaries order by nom_complet;";
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

// Modifier un utilisateur ou un groupe
router.put("/put/:type/:mode/:id?", (req, res) => {
    
    // déterminer le nom de la table en fonction du type
    let table = "";
    if (req.params.type === "user") {
        table = "salaries";
    } else if (req.params.type === "group") {
        table = "groupes";
    }

    const MODE = req.params.mode; // update, add
    const ID = req.params.id ? req.params.id : null;
    const UPDATE_DATA = req.body; // Récupérer l'objet JSON reçu

    message = "/put/" + req.params.type + "/" + MODE;

    console.log("Opération sur un utilisateur en mode : " + MODE);
    console.log("Body reçu pour la mise à jour :", UPDATE_DATA);

    try {
        let queryObject = {};
        if (MODE === "update" && ID !== null) {
            // Préparer la requête de mise à jour
            console.log("Valeur de la variable ID : " + ID);
            queryObject = generateUpdateQuery(
                "admin." + table,
                ID,
                UPDATE_DATA
            );
        }
        console.log("Requête de mise à jour de salarié générée : ");
        console.log(queryObject);
        

        // Exécuter la requête de mise à jour
        ExecuteQuerySite(
            pool,
            { query: queryObject, message: message },
            "update",
            (resultats, message) => {
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Content-Type", "application/json; charset=utf-8");

                if (message === 'ok') {
                    res.status(200).json({
                        success: true,
                        message: "Mise à jour réussie de l'utilisateur " + UPDATE_DATA["prenom"] + " " + UPDATE_DATA["nom"] + ".",
                        code: 0,
                        data: resultats
                    });
                } else {
                    const currentDateTime = new Date().toISOString();
                    console.log(`Échec de la requête à ${currentDateTime}`);
                    console.log(updateQuery.text);
                    console.log(updateQuery.values);
                    res.status(500).json({
                        success: false,
                        message: "Erreur, la requête s'est mal exécutée."
                    });
                }
            }
        );
    } catch (error) {
        console.error("Erreur lors de la mise à jour : ", error);
        res.status(500).json({
            success: false,
            message: "Erreur interne du serveur.",
        });
    }
});

// Supprimer unutilisateur, un groupe, etc.
// La route est maintenant gérée par handleDelete dans fonctions/routeHandlers.js
// C'est plus propre et évite la duplication de code
// On délègue la logique de suppression à handleDelete qui est un fichier à part, partagé entre plusieurs routes si besoin
router.delete("/delete/:table/:uuidName=:id/:idBisName?/:idBis?", (req, res) => {
    handleDelete(req, res, pool);
});


// Récupérer des groupes ( un ou plusieurs )
router.get("/group/:mode/:gro_id?", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();
    mode = req.params.mode;
    const gro_id = req.params.gro_id ? req.params.gro_id : null;
    message = "/groups/" + mode;
    if (req.params.mode == "lite") {
        SelectFields =
            "SELECT gro_id, gro_nom, gro_description ";
        FromTable = "FROM admin.groupes order by gro_id;";
    } else if (req.params.mode == "full") {
        SelectFields =
            "select gro_id, gro_nom, gro_description, gro_statut ";
        FromTable = "FROM admin.groupes AS gro ";
        FromTable += " ";
        where = "where gro.gro_id = $1;";
    }

    executeQueryAndRespond(
        pool,
        SelectFields,
        FromTable,
        where,
        gro_id,
        res,
        message,
        mode
    );
});

module.exports = router;