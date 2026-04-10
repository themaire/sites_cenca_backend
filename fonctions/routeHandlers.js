const { generateDeleteQuery } = require('./querys.js');
const { ExecuteQuerySite } = require('./fonctionsSites.js');

// Supprimer une opération, une localisation (d'opération), un projet, etc.
function handleDelete(req, res, pool) {
    const table = req.params.table.split(".");
    const uuidName = req.params.uuidName;
    const id = req.params.id;
    const idBisName = req.params.idBisName;
    const idBis = req.params.idBis;

    const fullTableName = String(req.params.table || '').toLowerCase();
    const isActesMfuDelete =
        (fullTableName === 'sitcenca.actes_mfu' || fullTableName === 'actes_mfu') &&
        uuidName === 'uuid_acte';
    
    try {
        if (isActesMfuDelete) {
            const executeActeDelete = async () => {
                await pool.query('BEGIN');

                await pool.query(
                    `DELETE FROM sitcenca.actes_mfu_multi
                     WHERE ref_uuid_acte = $1`,
                    [id]
                );

                const deleteParentQuery = generateDeleteQuery(
                    req.params.table,
                    uuidName,
                    id
                );

                const deleteParentResult = await pool.query(
                    deleteParentQuery.text,
                    deleteParentQuery.values
                );

                await pool.query('COMMIT');

                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Content-Type", "application/json; charset=utf-8");

                res.status(200).json({
                    success: true,
                    message: "Suppression réussie.",
                    code: 0,
                    data: deleteParentResult.rows,
                });
            };

            executeActeDelete().catch(async (error) => {
                try {
                    await pool.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error("Erreur rollback suppression acte_mfu:", rollbackError);
                }

                console.error("Erreur lors de la suppression de l'acte MFU:", error);
                res.status(500).json({
                    success: false,
                    message: "Erreur lors de la suppression.",
                    code: 1,
                });
            });

            return;
        }

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