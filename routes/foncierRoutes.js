const express = require("express");
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const {
    joinQuery,
    selectQuery,
    ExecuteQuerySite,
    distinctSiteResearch,
    executeQueryAndRespond,
    reset,
} = require("../fonctions/fonctionsSites.js");
const pool = require("../dbPool/poolConnect.js");

// Route pour récupérer les actes fonciers d'un site
router.get("/pmfu/id=:id/:mode", (req, res) => {
    let SelectFields =
        "SELECT pmfu_id, pmfu_nom, pmfu_responsable, pmfu_agence, pmfu_associe, pmfu_etapes, pmfu_departement, pmfu_territoire, pmfu_type, pmfu_commune, pmfu_debut, pmfu_proprietaire, pmfu_appui, pmfu_juridique, pmfu_validation, pmfu_decision, pmfu_note, pmfu_acte, pmfu_compensatoire, pmfu_cout, pmfu_financements, pmfu_superficie, pmfu_priorite, pmf_status, pmfu_signature, pmfu_echeances, pmfu_creation, pmfu_derniere_maj, pmfu_photos_site, pmfu_date_ajout ";
    const FromTable = "FROM sitcenca.projets_mfu ";
    let where;
    let queryObject;

    const pmfu_id = req.params.id;
    console.log("pmfu_id : ");
    console.log(pmfu_id);
    if (req.params.mode == 'lite') {
        SelectFields = "SELECT pmfu_id, pmfu_nom, pmfu_responsable, pmfu_commune ";
        // "SELECT pmfu_id, pmfu_nom, pmfu_responsable, pmfu_agence, pmfu_associe, pmfu_etapes, pmfu_departement, pmfu_territoire, pmfu_type, pmfu_commune, pmfu_debut, pmfu_proprietaire, pmfu_appui, pmfu_juridique, pmfu_validation, pmfu_decision, pmfu_note, pmfu_acte, pmfu_compensatoire, pmfu_cout, pmfu_financements, pmfu_superficie, pmfu_priorite, pmf_status, pmfu_signature, pmfu_echeances, pmfu_creation, pmfu_derniere_maj, pmfu_photos_site, pmfu_date_ajout ";
        where = "";
        queryObject = {
            text: joinQuery(
                SelectFields,
                FromTable,
                where + " order by pmfu_date_ajout desc "
            ),
        };        
    } else if (req.params.mode == "full") {
        if (req.params.id) {
            where = "where pmfu_id = $1";
            queryObject = {
                text: joinQuery(SelectFields, FromTable, where),
                values: [pmfu_id],
            };
        } else {
            console.log("Aucun paramètre id fourni");
            console.log(req.params.id);
            res.status(400).send("Aucun paramètre id fourni");
            return;
        }
    }
    // console.log("queryObject : ", queryObject);

    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "foncier/pmfu" },
        "select",
        (resultats, message) => {
            if (resultats.length > 0 || message == "ok") {
                const json = JSON.stringify(resultats);
                // console.log(json);
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader(
                    "Content-Type",
                    "application/json; charset=utf-8"
                );
                res.end(json);
            } else {
                const json = JSON.stringify([]);
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader(
                    "Content-Type",
                    "application/json; charset=utf-8"
                );
                res.end(json);
            }
        }
    );
});

module.exports = router;
