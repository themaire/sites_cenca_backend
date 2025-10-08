const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
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
// Supprimer un fichier
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
        const queryObject = generateDeleteQuery(
            req.params.table,
            "doc_path",
            doc_path
        );
        console.log("queryObject avant exécution : " + JSON.stringify(queryObject));
        console.log("queryObject type : " + typeof queryObject);
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
                    //  suppression physique avec check path traversal
                    const ROOT_DIR = path.join(__dirname, "..");
                    const uploadsDir = path.resolve(ROOT_DIR, "mnt", "storage-data", "app");
                    const cacheDir = path.resolve(uploadsDir, "cache"); 
                    const filePath = path.resolve(uploadsDir, doc_path.split('\\').slice(-2).join('\\'));
                    const cachePath = path.resolve(cacheDir,'200-'+ doc_path.split('\\').pop());
                    console.log("Fichier à supprimer:", filePath);
                    console.log("cache path:", cachePath);
                    console.log("uploadsDir:", uploadsDir);
                    // Vérification : le fichier doit être dans le dossier downloads
                    if (!filePath.startsWith(uploadsDir)) {
                        console.warn("Tentative de path traversal détectée:", doc_path);
                        return res.status(400).json({
                            success: false,
                            message: "Chemin de fichier invalide",
                            code: 3,
                        });
                    }
                    if (cachePath.endsWith(".jpg") || cachePath.endsWith(".jpeg") || cachePath.endsWith(".png")) {
                        fs.unlink(cachePath, (err) => {
                            if (err) {
                                console.error("Erreur suppression fichier:", err);
                                return res.status(500).json({
                                    success: false,
                                    message: "Fichier introuvable ou non supprimé",
                                    code: 2,
                                });
                            }
                            console.log("Fichier supprimé:", cachePath);
                        })
                    }
                    fs.unlink(filePath, (err) => {
                        if (err) {
                            console.error("Erreur suppression fichier:", err);
                            return res.status(500).json({
                                success: false,
                                message: "Fichier introuvable ou non supprimé",
                                code: 2,
                            });
                        }
                        console.log("Fichier supprimé:", filePath);
                        res.status(200).json({
                            success: true,
                            message: "Suppression réussie du fichier.",
                            code: 0,
                            data: resultats,
                        });
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        message: "Erreur lors de la suppression en base.",
                        code: 1,
                    });
                }
            }
        );
    } catch (error) {
        console.error("Erreur lors de la suppression:", error);
        res.status(500).json({
            success: false,
            message: "Erreur interne du serveur.",
        });
    }
});
module.exports = router;
