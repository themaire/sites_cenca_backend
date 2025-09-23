const express = require("express");
const router = express.Router();
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // autorise toutes les origines
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Répond aux requêtes OPTIONS (préflight)
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

// Fonctions et connexion à PostgreSQL
const { ExecuteQuerySite } = require("../fonctions/fonctionsSites.js");
const pool = require("../dbPool/poolConnect.js");

// Generateur de requetes SQL
const { generateDeleteQuery } = require("../fonctions/querys.js");

// Supprimer une opération, une localisation (d'opération)
router.delete(
    "/delete/:table/:uuidName=:id/:idBisName?/:idBis?",
    (req, res) => {
        const table = req.params.table.split(".");
        const uuidName = req.params.uuidName; // Nom de la clé primaire
        const id = req.params.id;
        const idBisName = req.params.idBisName; // Nom de la clé supplémentaire (optionnel)
        const idBis = req.params.idBis; // Valeur de la clé supplémentaire (optionnel)
        console.log("table pour suppression : " + req.params.table);
        try {
            // Avant la gestion d'une eventuelle seconde clé primaire à utiliser pour supprimer un enregistrement
            // const queryObject = generateDeleteQuery(req.params.table, id, programmeId);

            // Si idBisName et idBis sont définis, passez-les à generateDeleteQuery
            const queryObject =
                idBisName && idBis
                    ? generateDeleteQuery(
                          req.params.table,
                          uuidName,
                          id,
                          idBisName,
                          idBis
                      )
                    : generateDeleteQuery(req.params.table, uuidName, id);

            ExecuteQuerySite(
                pool,
                {
                    query: queryObject,
                    message:
                        table[1].charAt(0).toUpperCase() +
                        table[1].slice(1) +
                        "/delete",
                },
                "delete",
                (resultats, message) => {
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader(
                        "Content-Type",
                        "application/json; charset=utf-8"
                    );

                    if (message === "ok") {
                        res.status(200).json({
                            success: true,
                            message: "Suppression réussie de l'opération.",
                            code: 0,
                            data: resultats,
                        });
                        console.log("message : " + message);
                    } else {
                        res.status(500).json({
                            success: false,
                            message: "Erreur lors de la suppression.",
                            code: 1,
                        });
                        console.log("message : " + message);
                    }
                }
            );
        } catch (error) {
            console.error(
                "Erreur lors de la suppression de l'opération:",
                error
            );
            res.status(500).json({
                success: false,
                message: "Erreur interne du serveur.",
            });
        }
    }
);
// Supprimer un Docfile
router.delete("/delete/:table", (req, res) => {
    const table = req.params.table.split(".");
    const doc_path = req.query.doc_path;
    console.log("doc_path : " + doc_path);
    console.log("table pour suppression : " + req.params.table);
    if (!doc_path) {
        return res.status(400).json({
            success: false,
            message: "Paramètre doc_path manquant",
            code: 1,
        });
    }
    try {
        // Avant la gestion d'une eventuelle seconde clé primaire à utiliser pour supprimer un enregistrement
        // const queryObject = generateDeleteQuery(req.params.table, id, programmeId);
        const queryObject = generateDeleteQuery(
            req.params.table,
            "doc_path",
            doc_path
        );
        ExecuteQuerySite(
            pool,
            {
                query: queryObject,
                message:
                    table[1].charAt(0).toUpperCase() +
                    table[1].slice(1) +
                    "/delete",
            },
            "delete",
            (resultats, message) => {
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader(
                    "Content-Type",
                    "application/json; charset=utf-8"
                );

                if (message === "ok") {
                    res.status(200).json({
                        success: true,
                        message: "Suppression réussie de l'opération.",
                        code: 0,
                        data: resultats,
                    });
                    console.log("message : " + message);
                } else {
                    res.status(500).json({
                        success: false,
                        message: "Erreur lors de la suppression.",
                        code: 1,
                    });
                    console.log("message : " + message);
                }
            }
        );
    } catch (error) {
        console.error("Erreur lors de la suppression de l'opération:", error);
        res.status(500).json({
            success: false,
            message: "Erreur interne du serveur.",
        });
    }
});
module.exports = router;
