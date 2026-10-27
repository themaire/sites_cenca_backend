// Documents (files.docs) liés à des éléments : sites, projets MFU...
// Monté sur /sites dans node_base_sites.js
const express = require("express");
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const { executeQueryAndRespond, reset } = require("../../fonctions/fonctionsSites.js");
const pool = require("../../dbPool/poolConnect.js");

// Pour récuperer les documents liés à des éléments (sites, projets mfu ...).
router.get("/docs/:section/cd_type=:cd_type/:mode/:ref_id?",
    async (req, res) => {
        let { SelectFields, FromTable, where, message } = reset();
        const { ref_id, cd_type, mode, section } = req.params;

        SelectFields = `SELECT doc_id, ref_id, doc_type, doc_path, libnom_id `;
        FromTable = "FROM files.docs ";
        message =
            "docs/section:" + section + "/cd_type=" + cd_type + "/" + mode;
        let values;

        if (mode === "lite") {
            message = "docs/doc_type/" + mode;
            where = "WHERE doc_type = $1 AND libnom_id = $2";
            values = [cd_type, section];
        } else if (mode === "full") {
            message = "docs/id/" + mode;
            if (ref_id && cd_type == 0) {
                SelectFields = `SELECT doc_type `;
                where = "WHERE libnom_id = $1 AND ref_id = $2";
                values = [section, ref_id];
            } else if (ref_id) {
                where =
                    "WHERE doc_type = $1 AND ref_id = $2 AND libnom_id = $3";
                values = [cd_type, ref_id, section];
            } else {
                return res.status(400).send("Paramètre 'ref_id' requis");
            }
        }
        executeQueryAndRespond(
            pool,
            SelectFields,
            FromTable,
            where,
            values,
            res,
            message,
            mode
        );
    }
);


module.exports = router;
