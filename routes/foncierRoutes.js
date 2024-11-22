const express = require('express');
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const { joinQuery, selectQuery, ExecuteQuerySite, distinctSiteResearch, executeQueryAndRespond, reset } = require('../fonctions/fonctionsSites.js'); 
const pool = require('../dbPool/poolConnect.js');




// Demandes d'extractions foncières
router.get("/foncier/extraction=:id", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();

    const ID = req.params.id;
    const MESSAGE = "sites/foncier/id";
    
    SelectFields = "SELECT ";
    SelectFields +=
        "ext_id, ref_cd_salarie, ext_code_site, ext_description, ext_date ";
    FromTable = "FROM foncier.extractions ";

    if (ID == "null") {
        queryObject = {
            text: SelectFields + FromTable
        };
    } else {
        where = "where ext_id = $1";
        queryObject = {
            text: joinQuery(SelectFields, FromTable, where),
            values: [ID],
        };
    }

    // console.log("queryObject : ", queryObject);

    ExecuteQuerySite(
        pool,
        { query: queryObject, message: MESSAGE },
        "select",
        ( resultats ) => {
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
        }
    );
});



module.exports = router;
