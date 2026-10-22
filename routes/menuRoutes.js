const express = require('express');
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const { joinQuery, ExecuteQuerySite, ExecuteQuerySitePromise } = require('../fonctions/fonctionsSites.js');

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

// Arbre complet du menu en une seule requête, au lieu d'un appel par niveau, gardé en mémoire.
// La table ne change qu'à la main (pgAdmin, QGIS) : une modification apparaît au plus tard
// après DUREE_CACHE_MENU_MS (+ le max-age du navigateur), ou au redémarrage du backend.
const DUREE_CACHE_MENU_MS = 10 * 60 * 1000;
const ID_MENU_ADMIN = 28; // « Paramètres », masqué hors admin comme dans /parent=null
let cacheMenu = null; // { arbres: { admin, public }, expire }

// Même ordre que les routes par parent (order by men_order : null en dernier), puis id pour départager
const comparerMenus = (a, b) =>
    (a.men_order ?? Infinity) - (b.men_order ?? Infinity) || a.id - b.id;

// Lignes à plat → racines avec leurs `enfants` imbriqués (tableau vide pour une feuille).
// Une ligne dont le parent n'existe pas est ignorée, comme dans le parcours niveau par niveau.
const construireArbre = (lignes) => {
    const noeuds = new Map(lignes.map(ligne => [ligne.id, { ...ligne, enfants: [] }]));
    const racines = [];
    for (const noeud of noeuds.values()) {
        if (noeud.parent == null) racines.push(noeud);
        else noeuds.get(noeud.parent)?.enfants.push(noeud);
    }
    const trier = (liste) => {
        liste.sort(comparerMenus);
        liste.forEach(noeud => trier(noeud.enfants));
        return liste;
    };
    return trier(racines);
};

// Menu complet (Route non protégée) : /menu/arbre, ou /menu/arbre/admin avec « Paramètres »
router.get("/arbre/:pref?", async (req, res) => {
    try {
        if (!cacheMenu || Date.now() > cacheMenu.expire) {
            const { rows } = await ExecuteQuerySitePromise(
                pool,
                { query: { text: "SELECT * FROM gestint.m_menu_header" }, message: "menu/arbre" },
                "select"
            );
            const admin = construireArbre(rows);
            cacheMenu = {
                arbres: { admin, public: admin.filter(menu => menu.id !== ID_MENU_ADMIN) },
                expire: Date.now() + DUREE_CACHE_MENU_MS,
            };
        }
        // res.json ajoute un ETag : le navigateur reçoit un 304 sans corps si rien n'a changé
        res.set("Cache-Control", "private, max-age=300");
        res.json(cacheMenu.arbres[req.params.pref === "admin" ? "admin" : "public"]);
    } catch (error) {
        console.error("Error in menu/arbre route: ", error);
        res.status(500).json({
            success: false,
            message: "Erreur interne du serveur."
        });
    }
});

module.exports = router;