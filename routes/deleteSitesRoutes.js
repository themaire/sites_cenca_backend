const express = require('express');
const router = express.Router();


// Fonctions et connexion à PostgreSQL
const { ExecuteQuerySite } = require('../fonctions/fonctionsSites.js'); 
const pool = require('../dbPool/poolConnect.js');

// Generateur de requetes SQL
const { generateDeleteQuery } = require('../fonctions/querys.js');

// Supprimer une opération, une localisation (d'opération)
router.delete("/delete/:table/uuid=:id/:idBisName?/:idBis?", (req, res) => {
    const table = req.params.table.split('.');
    const id = req.params.id;
    const idBisName = req.params.idBisName; // Nom de la clé supplémentaire (optionnel)
    const idBis = req.params.idBis; // Valeur de la clé supplémentaire (optionnel)

    try {
        // Avant la gestion d'une eventuelle seconde clé primaire à utiliser pour supprimer un enregistrement
        // const queryObject = generateDeleteQuery(req.params.table, id, programmeId);

        // Si idBisName et idBis sont définis, passez-les à generateDeleteQuery
        const queryObject = idBisName && idBis
            ? generateDeleteQuery(req.params.table, id, idBisName, idBis)
            : generateDeleteQuery(req.params.table, id);

        ExecuteQuerySite(
            pool,
            { query: queryObject, message: table[1].charAt(0).toUpperCase() + table[1].slice(1) + "/delete" },
            "delete",
            (resultats, message) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Content-Type", "application/json; charset=utf-8");

            if (message === 'ok') {
                res.status(200).json({
                success: true,
                message: "Suppression réussie de l'opération.",
                code: 0,
                data: resultats
                });
                console.log("message : " + message);
            } else {
                res.status(500).json({
                success: false,
                message: "Erreur lors de la suppression.",
                code: 1
                });
                console.log("message : " + message);
            }
            }
        );
    } catch (error) {
        console.error("Erreur lors de la suppression de l'opération:", error);
        res.status(500).json({
            success: false,
            message: "Erreur interne du serveur."
        });
    }
});

module.exports = router;
