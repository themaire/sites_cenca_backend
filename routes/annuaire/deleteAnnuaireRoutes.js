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

// Données qui référencent un contact sans suppression en cascade : elles empêchent sa suppression.
const CONTACT_DELETE_BLOCKERS = [
    { table: "sitcenca.conservateurs", colonne: "societe", libelle: "site(s) dont il est conservateur" },
    { table: "sitcenca.agriculteurs_contrats", colonne: "societe", libelle: "contrat(s) agriculteur" },
    { table: "opegerer.operations", colonne: "ref_uuid_ann", libelle: "opération(s) dont il est maître d'œuvre" },
    { table: "opegerer.intervenants", colonne: "societe", libelle: "intervention(s) (opérations gérées)" },
    { table: "opeautres.intervenants", colonne: "intervenant", libelle: "intervention(s) (autres opérations)" },
];

async function getContactDeleteDependances(uuid) {
    const countSql = CONTACT_DELETE_BLOCKERS.map(
        (b, i) => `(SELECT count(*) FROM ${b.table} WHERE ${b.colonne} = $1) AS c${i}`
    ).join(", ");
    const counts = (await pool.query("SELECT " + countSql, [uuid])).rows[0];
    return CONTACT_DELETE_BLOCKERS.map((b, i) => ({ table: b.table, libelle: b.libelle, nombre: parseInt(counts["c" + i], 10) }))
        .filter((d) => d.nombre > 0);
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
        if (err.code === "23503") {
            // Contact encore référencé ailleurs (clé étrangère sans cascade)
            try {
                const dependances = await getContactDeleteDependances(req.params.uuid);
                const detail = dependances.length
                    ? " : " + dependances.map((d) => d.nombre + " " + d.libelle).join(", ")
                    : "";
                return res.status(409).json({
                    success: false,
                    message: "Suppression impossible, ce contact est encore utilisé" + detail + ".",
                    data: { dependances },
                });
            } catch (countErr) {
                return sendError(res, "Erreur lors de la vérification des données liées au contact.", countErr);
            }
        }
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
