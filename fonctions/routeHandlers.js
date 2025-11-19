const { generateDeleteQuery } = require('./querys.js');
const { ExecuteQuerySite } = require('./fonctionsSites.js');

// Supprimer une opération, une localisation (d'opération), un projet, etc.
function handleDelete(req, res, pool) {
    const table = req.params.table.split(".");
    const uuidName = req.params.uuidName;
    const id = req.params.id;
    const idBisName = req.params.idBisName;
    const idBis = req.params.idBis;
    
    try {
        const queryObject = idBisName && idBis
            ? generateDeleteQuery(req.params.table, uuidName, id, idBisName, idBis)
            : generateDeleteQuery(req.params.table, uuidName, id);

        ExecuteQuerySite(
            pool,
            {
                query: queryObject,
                message: table[1].charAt(0).toUpperCase() + table[1].slice(1) + "/delete",
            },
            "delete",
            (resultats, message) => {
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Content-Type", "application/json; charset=utf-8");

                if (message === "ok") {
                    res.status(200).json({
                        success: true,
                        message: "Suppression réussie.",
                        code: 0,
                        data: resultats,
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        message: "Erreur lors de la suppression.",
                        code: 1,
                    });
                }
            }
        );
    } catch (error) {
        console.error("Erreur lors de la suppression:", error);
        res.status(500).json({
            success: false,
            message: "Erreur interne du serveur.",
        });
    }
}

module.exports = { handleDelete };