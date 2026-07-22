"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../../dbPool/poolConnect.js");

// Helper réponse JSON standard
function sendJson(res, data) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).json(data);
}

function sendError(res, message, err) {
    console.error(`[annuaire] ${message}`, err?.message || err);
    res.status(500).json({ success: false, message, detail: err?.message, hint: err?.hint, position: err?.position });
}

// ─── GET /annuaire ────────────────────────────────────────────────────────────
// Liste des contacts (lite), avec compétences/étiquettes agrégées.
// Filtres optionnels : typ_personne, validite, q (recherche sur le nom)
router.get("/", async (req, res) => {
    const { typ_personne, validite, q } = req.query;

    const conditions = [];
    const values = [];
    let i = 1;

    if (typ_personne) { conditions.push(`a.typ_personne = $${i++}`); values.push(typ_personne); }
    if (validite !== undefined) { conditions.push(`a.validite = $${i++}`); values.push(validite === "true" || validite === "1"); }
    if (q) { conditions.push(`a.nom ILIKE $${i++}`); values.push(`%${q}%`); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
        SELECT
            a.uuid_ann, a.nom, a.adresse, a.val_tri, a.val_filtre, a.typ_personne,
            tp.libelle AS typ_personne_libelle,
            a.validite, a.telephone, a.mail, a.actuel,
            COALESCE(etq.etiquettes, '[]'::json) AS etiquettes
        FROM ann.annuaire a
        LEFT JOIN ann.typ_personnes tp ON a.typ_personne = tp.cd_type
        LEFT JOIN LATERAL (
            SELECT json_agg(json_build_object('cd_type', te.cd_type, 'libelle', te.libelle) ORDER BY te.libelle) AS etiquettes
            FROM ann.etiquettes e
            JOIN ann.typ_etiquettes te ON e.typ_etiquette = te.cd_type
            WHERE e.annuaire = a.uuid_ann
        ) etq ON TRUE
        ${where}
        ORDER BY a.nom;
    `;

    try {
        const result = await pool.query(sql, values);
        sendJson(res, result.rows);
    } catch (err) {
        sendError(res, "Erreur lors de la récupération de l'annuaire.", err);
    }
});

// ─── GET /annuaire/typ_personnes ──────────────────────────────────────────────
router.get("/typ_personnes", async (req, res) => {
    try {
        const result = await pool.query("SELECT cd_type, libelle FROM ann.typ_personnes ORDER BY libelle;");
        sendJson(res, result.rows);
    } catch (err) {
        sendError(res, "Erreur lors de la récupération des types de personnes.", err);
    }
});

// ─── GET /annuaire/typ_competences ────────────────────────────────────────────
router.get("/typ_competences", async (req, res) => {
    try {
        const result = await pool.query("SELECT cd_type, libelle FROM ann.typ_competences ORDER BY libelle;");
        sendJson(res, result.rows);
    } catch (err) {
        sendError(res, "Erreur lors de la récupération des types de compétences.", err);
    }
});

// ─── GET /annuaire/typ_etiquettes ─────────────────────────────────────────────
router.get("/typ_etiquettes", async (req, res) => {
    try {
        const result = await pool.query("SELECT cd_type, libelle FROM ann.typ_etiquettes ORDER BY libelle;");
        sendJson(res, result.rows);
    } catch (err) {
        sendError(res, "Erreur lors de la récupération des types d'étiquettes.", err);
    }
});

// ─── GET /annuaire/:uuid ───────────────────────────────────────────────────────
// Détail d'un contact (fiche complète)
router.get("/:uuid", async (req, res) => {
    const sql = `
        SELECT a.uuid_ann, a.nom, a.adresse, a.val_tri, a.val_filtre, a.typ_personne,
               tp.libelle AS typ_personne_libelle,
               a.validite, a.telephone, a.mail, a.actuel
        FROM ann.annuaire a
        LEFT JOIN ann.typ_personnes tp ON a.typ_personne = tp.cd_type
        WHERE a.uuid_ann = $1;
    `;
    try {
        const result = await pool.query(sql, [req.params.uuid]);
        if (!result.rows.length) return res.status(404).json({ success: false, message: "Contact introuvable." });
        sendJson(res, result.rows[0]);
    } catch (err) {
        sendError(res, "Erreur lors de la récupération du contact.", err);
    }
});

// ─── GET /annuaire/:uuid/competences ──────────────────────────────────────────
router.get("/:uuid/competences", async (req, res) => {
    const sql = `
        SELECT c.annuaire, c.typ_competence, tc.libelle, c.notation, c.remarque
        FROM ann.competences c
        LEFT JOIN ann.typ_competences tc ON c.typ_competence = tc.cd_type
        WHERE c.annuaire = $1
        ORDER BY tc.libelle;
    `;
    try {
        const result = await pool.query(sql, [req.params.uuid]);
        sendJson(res, result.rows);
    } catch (err) {
        sendError(res, "Erreur lors de la récupération des compétences.", err);
    }
});

// ─── GET /annuaire/:uuid/etiquettes ───────────────────────────────────────────
router.get("/:uuid/etiquettes", async (req, res) => {
    const sql = `
        SELECT e.annuaire, e.typ_etiquette, te.libelle
        FROM ann.etiquettes e
        LEFT JOIN ann.typ_etiquettes te ON e.typ_etiquette = te.cd_type
        WHERE e.annuaire = $1
        ORDER BY te.libelle;
    `;
    try {
        const result = await pool.query(sql, [req.params.uuid]);
        sendJson(res, result.rows);
    } catch (err) {
        sendError(res, "Erreur lors de la récupération des étiquettes.", err);
    }
});

module.exports = router;
