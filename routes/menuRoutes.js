const express = require('express');
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const { joinQuery, ExecuteQuerySite } = require('../fonctions/fonctionsSites.js'); 

const { authenticateToken } = require('../fonctions/fonctionsAuth.js'); 

const pool = require('../dbPool/poolConnect.js');

// Menu (Route non protégée)
router.get("/parent=:parent/:pref?", (req, res) => {

    const SelectFields = "SELECT * ";
    const FromTable = "FROM gestint.m_menu_header ";
    let where;
    let queryObject;

    const parent = req.params.parent;
    const pref = req.params.pref;
    // console.log("parent : ");
    // console.log(parent);

    if (parent == "null") {
        where = pref != null && pref == "admin" ? "where parent is null" : "where parent is null and id != 28";
        queryObject = {
            text: joinQuery(
                SelectFields,
                FromTable,
                where + " order by men_order"
            )
        };
    } else {
        where = "where parent = $1 order by men_order";
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

    const SelectFields = "SELECT * ";
    const FromTable = "FROM gestint.m_menu_header ";
    let where;
    let queryObject;

    const parent = req.params.parent;
    console.log("parent : ");
    console.log(parent);

    if (req.params.parent == "null") {
        where = "where parent is null";
        queryObject = {
            text: joinQuery(
                SelectFields,
                FromTable,
                where + " order by men_order"
            )
        };
    } else {
        where = "where parent = $1 order by men_order";
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