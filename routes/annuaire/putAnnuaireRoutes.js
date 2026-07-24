"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../../dbPool/poolConnect.js");
const { authenticateToken } = require("../../fonctions/fonctionsAuth.js");

// Toutes les routes PUT/POST annuaire nécessitent une authentification
router.use(authenticateToken);

function sendJson(res, data, status = 200) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(status).json(data);
}

function sendError(res, message, err) {
    console.error(`[annuaire] ${message}`, err?.message || err);
    res.status(500).json({ success: false, message, detail: err?.message, hint: err?.hint, position: err?.position });
}

// ─── POST /annuaire ────────────────────────────────────────────────────────────
// Créer un nouveau contact
router.post("/", async (req, res) => {
    const { nom, adresse, val_tri, val_filtre, typ_personne, validite, telephone, mail, actuel } = req.body;

    const sql = `
        INSERT INTO ann.annuaire
            (uuid_ann, nom, adresse, val_tri, val_filtre, typ_personne, validite, telephone, mail, actuel)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING uuid_ann;
    `;
    try {
        const result = await pool.query(sql, [
            nom, adresse || null, val_tri ?? null, val_filtre ?? null, typ_personne || null,
            validite ?? true, telephone || null, mail || null, actuel || null
        ]);
        sendJson(res, { success: true, uuid_ann: result.rows[0].uuid_ann }, 201);
    } catch (err) {
        sendError(res, "Erreur lors de la création du contact.", err);
    }
});

// ─── PUT /annuaire/:uuid ───────────────────────────────────────────────────────
// Modifier un contact existant
router.put("/:uuid", async (req, res) => {
    const { nom, adresse, val_tri, val_filtre, typ_personne, validite, telephone, mail, actuel } = req.body;

    const sql = `
        UPDATE ann.annuaire
        SET nom          = $1,
            adresse      = $2,
            val_tri      = $3,
            val_filtre   = $4,
            typ_personne = $5,
            validite     = $6,
            telephone    = $7,
            mail         = $8,
            actuel       = $9
        WHERE uuid_ann = $10
        RETURNING uuid_ann;
    `;
    try {
        const result = await pool.query(sql, [
            nom, adresse || null, val_tri ?? null, val_filtre ?? null, typ_personne || null,
            validite ?? true, telephone || null, mail || null, actuel || null,
            req.params.uuid
        ]);
        if (!result.rows.length) return res.status(404).json({ success: false, message: "Contact introuvable." });
        sendJson(res, { success: true, uuid_ann: result.rows[0].uuid_ann });
    } catch (err) {
        sendError(res, "Erreur lors de la modification du contact.", err);
    }
});

// ─── PUT /annuaire/:uuid/competences/:typ_competence ─────────────────────────
// Ajouter ou mettre à jour une compétence pour un contact (upsert)
router.put("/:uuid/competences/:typ_competence", async (req, res) => {
    const { notation, remarque } = req.body;
    const { uuid, typ_competence } = req.params;

    const sql = `
        INSERT INTO ann.competences (annuaire, typ_competence, notation, remarque)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (annuaire, typ_competence)
        DO UPDATE SET notation = EXCLUDED.notation, remarque = EXCLUDED.remarque;
    `;
    try {
        await pool.query(sql, [uuid, typ_competence, notation ?? null, remarque || null]);
        sendJson(res, { success: true });
    } catch (err) {
        sendError(res, "Erreur lors de l'enregistrement de la compétence.", err);
    }
});

// ─── PUT /annuaire/:uuid/etiquettes/:typ_etiquette ───────────────────────────
// Rattacher une étiquette à un contact (sans effet si déjà présente)
router.put("/:uuid/etiquettes/:typ_etiquette", async (req, res) => {
    const { uuid, typ_etiquette } = req.params;

    const sql = `
        INSERT INTO ann.etiquettes (annuaire, typ_etiquette)
        VALUES ($1, $2)
        ON CONFLICT (annuaire, typ_etiquette) DO NOTHING;
    `;
    try {
        await pool.query(sql, [uuid, typ_etiquette]);
        sendJson(res, { success: true });
    } catch (err) {
        sendError(res, "Erreur lors du rattachement de l'étiquette.", err);
    }
});

module.exports = router;
