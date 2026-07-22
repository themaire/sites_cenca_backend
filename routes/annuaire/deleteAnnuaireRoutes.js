"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../../dbPool/poolConnect.js");
const { authenticateToken } = require("../../fonctions/fonctionsAuth.js");

// Toutes les routes DELETE annuaire nécessitent une authentification
router.use(authenticateToken);

function sendError(res, message, err) {
    console.error(`[annuaire] ${message}`, err?.message || err);
    res.status(500).json({ success: false, message, detail: err?.message, hint: err?.hint, position: err?.position });
}

// ─── DELETE /annuaire/:uuid ────────────────────────────────────────────────────
// Supprime un contact (compétences/étiquettes supprimées par CASCADE FK)
router.delete("/:uuid", async (req, res) => {
    try {
        const result = await pool.query(
            "DELETE FROM ann.annuaire WHERE uuid_ann = $1 RETURNING uuid_ann;",
            [req.params.uuid]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, message: "Contact introuvable." });
        res.status(200).json({ success: true, uuid_ann: result.rows[0].uuid_ann });
    } catch (err) {
        sendError(res, "Erreur lors de la suppression du contact.", err);
    }
});

// ─── DELETE /annuaire/:uuid/competences/:typ_competence ──────────────────────
router.delete("/:uuid/competences/:typ_competence", async (req, res) => {
    const { uuid, typ_competence } = req.params;
    try {
        const result = await pool.query(
            "DELETE FROM ann.competences WHERE annuaire = $1 AND typ_competence = $2 RETURNING annuaire;",
            [uuid, typ_competence]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, message: "Compétence introuvable." });
        res.status(200).json({ success: true });
    } catch (err) {
        sendError(res, "Erreur lors de la suppression de la compétence.", err);
    }
});

// ─── DELETE /annuaire/:uuid/etiquettes/:typ_etiquette ─────────────────────────
router.delete("/:uuid/etiquettes/:typ_etiquette", async (req, res) => {
    const { uuid, typ_etiquette } = req.params;
    try {
        const result = await pool.query(
            "DELETE FROM ann.etiquettes WHERE annuaire = $1 AND typ_etiquette = $2 RETURNING annuaire;",
            [uuid, typ_etiquette]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, message: "Étiquette introuvable." });
        res.status(200).json({ success: true });
    } catch (err) {
        sendError(res, "Erreur lors de la suppression de l'étiquette.", err);
    }
});

module.exports = router;
