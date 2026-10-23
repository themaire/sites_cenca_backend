"use strict";

// Projets « autres » : suppression d'un projet ou d'une opération.
// Monté sur /sites/autres dans node_base_sites.js. Modèle de données : fonctions/projetsAutres.js
const express = require("express");
const router = express.Router();
const pool = require("../../dbPool/poolConnect.js");
const { authenticateToken } = require("../../fonctions/fonctionsAuth.js");
const { codeSalarie, journaliser } = require("../../fonctions/projetsAutres.js");

function sendError(res, message, err) {
    console.error(`[projets autres] ${message}`, err?.message || err);
    res.status(500).json({ success: false, message, detail: err?.message });
}

// Listes rattachées à une opération. Les clés étrangères sont en ON DELETE CASCADE mais NOT VALID
// (reprise des données historiques) : on supprime explicitement, dans la transaction, pour ne rien laisser d'orphelin.
const LISTES_OPERATION = [
    ["opeautres.localisations", "uuid_ope"],
    ["opeautres.cibles_ope", "operation"],
    ["opeautres.eval_indicateurs", "operation"],
    ["opeautres.intervenants", "operation"],
];

async function supprimerListes(client, uuidsOpe) {
    for (const [table, colonne] of LISTES_OPERATION)
        await client.query(`DELETE FROM ${table} WHERE ${colonne} = ANY($1::text[])`, [uuidsOpe]);
}

// ─── DELETE /sites/autres/projets/:uuid ───────────────────────────────────────
// Supprime le projet, ses opérations et leurs listes
router.delete("/projets/:uuid", authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const opes = await client.query("SELECT uuid_ope FROM opeautres.operations WHERE projet = $1", [req.params.uuid]);
        const uuidsOpe = opes.rows.map((r) => r.uuid_ope);
        await supprimerListes(client, uuidsOpe);
        await client.query("DELETE FROM opeautres.operations WHERE projet = $1", [req.params.uuid]);
        const result = await client.query("DELETE FROM opeautres.projets WHERE uuid_proj = $1 RETURNING uuid_proj", [req.params.uuid]);
        if (!result.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Projet introuvable." });
        }
        const compte = await codeSalarie(client, req.tokenInfos?.identifiant);
        for (const uuidOpe of uuidsOpe) await journaliser(client, compte, "opeautres.operations", uuidOpe, "DELETE");
        await journaliser(client, compte, "opeautres.projets", req.params.uuid, "DELETE");
        await client.query("COMMIT");
        res.status(200).json({ success: true, message: "Projet supprimé.", uuid_proj: req.params.uuid, operations_supprimees: uuidsOpe.length });
    } catch (err) {
        await client.query("ROLLBACK");
        sendError(res, "Erreur lors de la suppression du projet.", err);
    } finally {
        client.release();
    }
});

// ─── DELETE /sites/autres/operations/:uuid ────────────────────────────────────
// Supprime l'opération et ses listes
router.delete("/operations/:uuid", authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await supprimerListes(client, [req.params.uuid]);
        const result = await client.query("DELETE FROM opeautres.operations WHERE uuid_ope = $1 RETURNING uuid_ope", [req.params.uuid]);
        if (!result.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Opération introuvable." });
        }
        await journaliser(client, await codeSalarie(client, req.tokenInfos?.identifiant), "opeautres.operations", req.params.uuid, "DELETE");
        await client.query("COMMIT");
        res.status(200).json({ success: true, message: "Opération supprimée.", uuid_ope: req.params.uuid });
    } catch (err) {
        await client.query("ROLLBACK");
        sendError(res, "Erreur lors de la suppression de l'opération.", err);
    } finally {
        client.release();
    }
});

module.exports = router;
