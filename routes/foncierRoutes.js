const express = require('express');
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const { joinQuery, selectQuery, ExecuteQuerySite, distinctSiteResearch, executeQueryAndRespond, reset } = require('../fonctions/fonctionsSites.js'); 
const pool = require('../dbPool/poolConnect.js');

// Demandes d'extractions foncières
router.get("/foncier/extraction=:id", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();

    const ID = req.params.id;
    const MESSAGE = "sites/foncier/extraction";
    
    SelectFields =  "SELECT ";
    SelectFields += 'ext_id, ref_cd_salarie, sal.prenom || \' \' || sal.nom as "nom_complet", ext_code_site, ext_description, TO_CHAR(ext_date, \'DD/MM/YYYY\') AS date ';
    FromTable =     "FROM foncier.extractions ";
    FromTable +=    'LEFT JOIN admin.salaries sal ON extractions.ref_cd_salarie = sal.cd_salarie ';

    if (ID !== "null") {
        where = "where ext_id = $1";
    }

    executeQueryAndRespond(pool, SelectFields, FromTable, where, ID, res, message)
});

// Obtenir les parcelles d'extractions foncières
router.get("/foncier/parc_extraction=:id", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();

    const ID = req.params.id;
    const MESSAGE = "sites/foncier/parcelles_extraction";
    
    SelectFields =  "SELECT ";
    SelectFields += 'parex_id, ref_ext_id, parex_insee, parex_section, parex_numero, parex_prefixe ';
    FromTable =     "FROM foncier.parc_extraction ";
    where = "where ref_ext_id = $1";

    executeQueryAndRespond(pool, SelectFields, FromTable, where, ID, res, message)
});

module.exports = router;
