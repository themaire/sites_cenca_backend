const express = require("express");
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const {joinQuery, selectQuery, ExecuteQuerySite, distinctSiteResearch,
    executeQueryAndRespond, reset, getBilan,} = require("../fonctions/fonctionsSites.js");
const { generateFicheTravauxWord } = require("../scripts/gen_fiche_travaux.js");
const pool = require("../dbPool/poolConnect.js");


// Utilisateurs
router.get("/users/:mode", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();
    mode = req.params.mode;
    message = "/users/" + mode;

    if (req.params.mode == "lite") {
        SelectFields =
            "SELECT cd_salarie, \"nom complet\" as nom_complet, email, fonction, identifiant ";
        FromTable = "FROM admin.v_salaries";
    } else if (req.params.mode == "full") {
        SelectFields =
            "select cd_salarie, nom, prenom, email, statut, typ_fonction, identifiant, sal_role ";
        FromTable = "FROM admin.salaries AS sal ";
        FromTable += " ";
        where = "where sal.cd_salarie = $1;";
    }

    executeQueryAndRespond(
        pool,
        SelectFields,
        FromTable,
        where,
        req.params.uuid,
        res,
        message,
        mode
    );
});

module.exports = router;