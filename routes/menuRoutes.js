const express = require('express');
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const { joinQuery, ExecuteQuerySite } = require('../fonctions/fonctionsSites.js'); 

const { authenticateToken } = require('../fonctions/fonctionsAuth.js'); 

const pool = require('../dbPool/poolConnect.js');

// Menu (Route non protégée)
router.get("/parent=:parent", (req, res) => {
    const SelectFields =
        "SELECT men_id as id, men_name as name, men_class_color as class_color, men_parent as parent, men_route as route, men_accueil as accueil, men_url as url , men_description as description, men_picture as picture, men_date_added as date_added, men_opened as opended ";
    const FromTable = "FROM gestint.menu_header ";
    let where;
    let queryObject;

    const parent = req.params.parent;
    console.log("parent : ");
    console.log(parent);

    if (parent == "null") {
        where = "where men_parent is null";
        queryObject = {
            text: joinQuery(
                SelectFields,
                FromTable,
                where + " order by men_order"
            )
        };
    } else {
        where = "where men_parent = $1 order by men_order";
        queryObject = {
        text: joinQuery(SelectFields, FromTable, where),
        values: [parent],
        };
    }

    // console.log("queryObject : ", queryObject);

    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "menu/parent" },
        "select",
        ( resultats, message ) => {
            try {
                if (resultats.length > 0) {
                    const json = JSON.stringify(resultats);
                    // console.log(json);
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.end(json);
                } else {
                    const json = JSON.stringify([]);
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.end(json);
                }
            } catch (error) {
                console.error("Error in menu/parent route: ", error);
                res.status(500).json({
                    success: false,
                    message: "Erreur interne du serveur."
                });
            }
        }
    );
});

// Menu (Route protégée)
router.get("/tokenparent=:parent", authenticateToken, (req, res) => {
    const SelectFields =
        "SELECT men_id as id, men_name as name, men_class_color as class_color, men_parent as parent, men_route as route, men_accueil as accueil, men_url as url , men_description as description, men_picture as picture, men_date_added as date_added, men_opened as opended ";
    const FromTable = "FROM gestint.menu_header ";
    let where;
    let queryObject;

    const parent = req.params.parent;
    console.log("parent : ");
    console.log(parent);

    if (req.params.parent == "null") {
        where = "where men_parent is null";
        queryObject = {
            text: joinQuery(
                SelectFields,
                FromTable,
                where + " order by men_order"
            )
        };
    } else {
        where = "where men_parent = $1 order by men_order";
        queryObject = {
        text: joinQuery(SelectFields, FromTable, where),
        values: [parent],
        };
    }

    // console.log("queryObject : ", queryObject);

    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "menu/parent" },
        "select",
        ( resultats, message ) => {
            if (resultats.length > 0 || message == "ok") {
                const json = JSON.stringify(resultats);
                // console.log(json);
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(json);
            } else {
                const json = JSON.stringify([]);
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(json);
            }
        }
    );
});

module.exports = router;