"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../../dbPool/poolConnect.js");
const { authenticateToken } = require("../../fonctions/fonctionsAuth.js");

// Toutes les routes DELETE chiro nécessitent une authentification
router.use(authenticateToken);

function sendError(res, message, err) {
    console.error(`[chiro] ${message}`, err?.message || err);
    res.status(500).json({ success: false, message, detail: err?.message, hint: err?.hint, position: err?.position });
}

// ─── E4. DELETE /chiro/site/:id ──────────────────────────────────────────────
// Refus si des relevés sont liés ; sinon suppression site + commune + localisation
router.delete("/site/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const check = await pool.query(
            "SELECT COUNT(*) FROM chiro.releves WHERE site = $1", [id]
        );
        if (parseInt(check.rows[0].count) > 0) {
            return res.status(409).json({ error: "Ce site possède des relevés et ne peut pas être supprimé." });
        }
        await pool.query("DELETE FROM chiro.communes_sites WHERE site = $1", [id]);
        await pool.query("DELETE FROM chiro.localisations WHERE site = $1", [id]);
        await pool.query("DELETE FROM chiro.sites WHERE id_site = $1", [id]);
        res.json({ ok: true });
    } catch (err) {
        console.error("[chiro] Erreur suppression site", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── C4. DELETE /chiro/releve/:uuid ──────────────────────────────────────────
// Supprimer un relevé (observations → mortalites/biometries supprimées par CASCADE FK)
router.delete("/releve/:uuid", async (req, res) => {
    try {
        const result = await pool.query(
            "DELETE FROM chiro.releves WHERE uuid_releve = $1 RETURNING uuid_releve",
            [req.params.uuid]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, message: "Relevé introuvable." });
        res.status(200).json({ success: true, uuid_releve: result.rows[0].uuid_releve });
    } catch (err) {
        sendError(res, "Erreur lors de la suppression du relevé.", err);
    }
});

// ─── C7. DELETE /chiro/observation/:uuid ─────────────────────────────────────
// La mortalite est supprimée automatiquement par CASCADE FK
router.delete("/observation/:uuid", async (req, res) => {
    try {
        await pool.query(
            "DELETE FROM chiro.observations WHERE uuid_observation = $1",
            [req.params.uuid]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error("[chiro] Erreur suppression observation", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
