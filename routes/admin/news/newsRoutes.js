const express = require("express");
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const { ExecuteQuerySite, executeQueryAndRespond } = require("../../../fonctions/fonctionsSites.js");
const pool = require("../../../dbPool/poolConnect.js");
const { generateUpdateQuery } = require("../../../fonctions/querys.js");
const { authenticateToken } = require("../../../fonctions/fonctionsAuth.js");

// Liste allégée des news pour le tableau d'administration
router.get("/news/lite", authenticateToken, (req, res) => {
    const SelectFields = "SELECT id, titre, date_publication, publie ";
    const FromTable = "FROM gestint.news ORDER BY date_publication DESC;";
    executeQueryAndRespond(pool, SelectFields, FromTable, "", null, res, "admin/news/lite", "lite");
});

// Détail complet d'une news pour la boîte de dialogue d'édition
router.get("/news/full/:id", authenticateToken, (req, res) => {
    const SelectFields = "SELECT id, titre, resume, contenu, image_url, lien, date_publication, publie, ordre, cd_salarie, date_creation, date_modification ";
    const FromTable = "FROM gestint.news ";
    const where = "WHERE id = $1;";
    executeQueryAndRespond(pool, SelectFields, FromTable, where, req.params.id, res, "admin/news/full", "full");
});

// Créer une news
router.post("/post/news/create", authenticateToken, (req, res) => {
    const { titre, resume, contenu, image_url, lien, date_publication, publie, ordre, cd_salarie } = req.body;

    if (!titre || !resume) {
        return res.status(400).json({
            success: false,
            message: "Le titre et le résumé sont obligatoires.",
            code: 1,
            data: []
        });
    }

    const queryObject = {
        text: `INSERT INTO gestint.news
                   (titre, resume, contenu, image_url, lien, date_publication, publie, ordre, cd_salarie)
               VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), COALESCE($7, true), $8, $9)
               RETURNING *;`,
        values: [
            titre,
            resume,
            contenu ?? null,
            image_url ?? null,
            lien ?? null,
            date_publication ?? null,
            publie ?? null,
            ordre ?? null,
            cd_salarie ?? null
        ]
    };

    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "admin/post/news/create" },
        "insert",
        (resultats, message) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            if (message === "ok") {
                res.status(201).json({
                    success: true,
                    message: "News créée avec succès.",
                    code: 0,
                    data: resultats
                });
            } else {
                res.status(500).json({
                    success: false,
                    message: "Erreur lors de la création de la news.",
                    code: 1,
                    data: []
                });
            }
        }
    );
});

// Modifier une news
router.put("/put/news/update/:id", authenticateToken, (req, res) => {
    const ID = req.params.id;
    const UPDATE_DATA = { ...req.body, date_modification: new Date() };

    try {
        const queryObject = generateUpdateQuery("gestint.news", ID, UPDATE_DATA);

        ExecuteQuerySite(
            pool,
            { query: queryObject, message: "admin/put/news/update" },
            "update",
            (resultats, message) => {
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                if (message === "ok") {
                    res.status(200).json({
                        success: true,
                        message: "News mise à jour avec succès.",
                        code: 0,
                        data: resultats
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        message: "Erreur lors de la mise à jour de la news.",
                        code: 1,
                        data: []
                    });
                }
            }
        );
    } catch (error) {
        console.error("Erreur lors de la mise à jour de la news : ", error);
        res.status(500).json({
            success: false,
            message: "Erreur interne du serveur.",
            code: 1,
            data: []
        });
    }
});

// La suppression est gérée par la route générique DELETE /admin/delete/:table/:uuidName=:id
// (voir routes/admin/adminRoute.js -> handleDelete), utilisable telle quelle avec
// DELETE /admin/delete/gestint.news/id=:id

module.exports = router;
