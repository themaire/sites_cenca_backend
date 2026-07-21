const express = require("express");
const router = express.Router();

const { ExecuteQuerySite } = require("../fonctions/fonctionsSites.js");
const pool = require("../dbPool/poolConnect.js");

// Liste publique des news publiées, consommée par le site vitrine
router.get("/", (req, res) => {
    const limite = parseInt(req.query.limite, 10);
    const hasLimit = Number.isInteger(limite) && limite > 0;

    const queryObject = {
        text: `SELECT id, titre, resume, date_publication, lien, image_url
               FROM gestint.news
               WHERE publie = true
               ORDER BY date_publication DESC
               ${hasLimit ? "LIMIT $1" : ""};`,
        values: hasLimit ? [limite] : []
    };

    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "news/lite" },
        "select",
        (resultats) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.status(200).json(resultats);
        }
    );
});

// Détail complet d'une news publiée, pour la vue détaillée du site vitrine
router.get("/:id(\\d+)", (req, res) => {
    const queryObject = {
        text: `SELECT id, titre, resume, contenu, date_publication, lien, image_url
               FROM gestint.news
               WHERE id = $1 AND publie = true;`,
        values: [req.params.id]
    };

    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "news/full" },
        "select",
        (resultats) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            if (resultats.length > 0) {
                res.status(200).json(resultats[0]);
            } else {
                res.status(404).json({
                    success: false,
                    message: "News introuvable.",
                    code: 1,
                    data: []
                });
            }
        }
    );
});

module.exports = router;
