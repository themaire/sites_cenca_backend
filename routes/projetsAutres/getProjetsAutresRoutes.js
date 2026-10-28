"use strict";

// Projets « autres » (sensibilisation, études, police, foncier, partenariats...) : lecture.
// Monté sur /sites/autres dans node_base_sites.js. Modèle de données : fonctions/projetsAutres.js
const express = require("express");
const router = express.Router();
const pool = require("../../dbPool/poolConnect.js");
const { TYPES_EXCLUS, STATUTS, RACINES_PAR_TYPE, SQL_ARBRE_ACTIONS, lireProjet, lireOperation, vide } = require("../../fonctions/projetsAutres.js");

function sendJson(res, data, status = 200) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(status).json(data);
}

function sendError(res, message, err) {
    console.error(`[projets autres] ${message}`, err?.message || err);
    res.status(500).json({ success: false, message, detail: err?.message });
}

// ─── GET /sites/autres/nomenclatures ───────────────────────────────────────────
// Toutes les listes de choix du formulaire en un appel (types, statuts, cibles, indicateurs, rôles,
// types d'intervention, programmes). Les salariés : /sites/selectvalues=admin.salaries
router.get("/nomenclatures", async (req, res) => {
    try {
        const [types, cibles, indicateurs, roles, interventions, programmes] = await Promise.all([
            pool.query("SELECT cd_type, libelle FROM ope.typ_projets WHERE cd_type <> ALL($1::text[]) ORDER BY val_tri", [TYPES_EXCLUS]),
            pool.query("SELECT cd_type, libelle, cd_supra, val_filtre FROM opeautres.typ_cibles ORDER BY val_filtre NULLS LAST, cd_type"),
            pool.query("SELECT cd_indicateur AS cd_type, libelle FROM opeautres.typ_indicateurs WHERE cd_indicateur <> 'NR' ORDER BY libelle"),
            pool.query("SELECT cd_type, libelle FROM ope.typ_roles ORDER BY libelle"),
            pool.query("SELECT cd_type, lib_type AS libelle, val_filtre FROM ope.typ_interventions WHERE cd_type <> 'NR' ORDER BY lib_type"),
            pool.query("SELECT cd_programme AS cd_type, cd_programme || ' - ' || libelle AS libelle FROM ope.listprogrammes ORDER BY cd_programme DESC"),
        ]);
        // Cibles : val_filtre 1 = publics visés (sensibilisation, partenariat), 2 = compartiments écologiques
        // (études, suivis), regroupés par cd_supra ; le reste (ex. Propriétaire) en « autres »
        const publics = cibles.rows.filter((c) => c.val_filtre === 1).map(({ cd_type, libelle }) => ({ cd_type, libelle }));
        const ecologiques = cibles.rows.filter((c) => c.val_filtre === 2).map(({ cd_type, libelle, cd_supra }) => ({ cd_type, libelle, groupe: cd_supra }));
        const autres = cibles.rows.filter((c) => c.val_filtre !== 1 && c.val_filtre !== 2).map(({ cd_type, libelle }) => ({ cd_type, libelle }));
        res.setHeader("Cache-Control", "no-store");
        sendJson(res, {
            typ_projets: types.rows,
            statuts: STATUTS,
            cibles: { publics, ecologiques, autres },
            indicateurs: indicateurs.rows,
            roles: roles.rows,
            typ_interventions: interventions.rows,
            programmes: programmes.rows,
        });
    } catch (err) {
        sendError(res, "Erreur lors de la lecture des nomenclatures.", err);
    }
});

// ─── GET /sites/autres/actions?typ_projet=SEN ─────────────────────────────────
// Arbre des actions hors travaux (ope.actions), branches imbriquées dans « enfants ».
// Avec typ_projet : les branches conseillées pour ce type passent en tête (conseillee = true).
router.get("/actions", async (req, res) => {
    const typ = req.query.typ_projet;
    const conseillees = RACINES_PAR_TYPE[typ] || [];
    try {
        const result = await pool.query(
            `${SQL_ARBRE_ACTIONS}
             SELECT cd_action, cd_sup, libelle, commentaire, racine, profondeur
               FROM arbre ORDER BY profondeur, val_tri NULLS LAST, libelle`
        );
        const noeuds = new Map(result.rows.map((a) => [a.cd_action, { ...a, enfants: [] }]));
        const racines = [];
        for (const n of noeuds.values()) {
            if (n.profondeur === 1) racines.push(n);
            else noeuds.get(n.cd_sup)?.enfants.push(n);
        }
        for (const r of racines) r.conseillee = conseillees.includes(r.cd_action);
        racines.sort((a, b) => {
            const ia = conseillees.indexOf(a.cd_action), ib = conseillees.indexOf(b.cd_action);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
        sendJson(res, racines);
    } catch (err) {
        sendError(res, "Erreur lors de la lecture des actions.", err);
    }
});

// ─── GET /sites/autres/localisants?q=texte&cat=COM&limite=50 ──────────────────
// Lieux possibles d'une opération : sites CENCA, autres espaces (N2000, RN...), territoires, communes.
// Recherche sans accents sur le nom ou le code (code site, n° INSEE)
router.get("/localisants", async (req, res) => {
    const q = (req.query.q || "").trim();
    const cat = req.query.cat || null;
    const limite = Math.min(parseInt(req.query.limite, 10) || 50, 500);
    if (q.length < 2 && !cat) return res.status(400).json({ success: false, message: "Paramètre q (2 caractères minimum) ou cat requis." });
    try {
        const result = await pool.query(
            `SELECT id_loc AS cd_localisation, code, libelle_loc AS libelle, cat, description
               FROM opeautres.localisants
              WHERE ($1 = '' OR unaccent(libelle_loc) ILIKE unaccent('%' || $1 || '%') OR code ILIKE $1 || '%')
                AND ($2::text IS NULL OR cat = $2)
              ORDER BY val_tri, libelle_loc
              LIMIT $3`,
            [q, cat, limite]
        );
        sendJson(res, result.rows);
    } catch (err) {
        sendError(res, "Erreur lors de la recherche de localisations.", err);
    }
});

// ─── GET /sites/autres/selectors ──────────────────────────────────────────────
// Valeurs des listes de la barre de recherche de projets autres
router.get("/selectors", async (req, res) => {
    try {
        const [annees, responsables, types] = await Promise.all([
            pool.query("SELECT DISTINCT annee FROM opeautres.projets WHERE validite IS NOT FALSE AND annee IS NOT NULL ORDER BY annee DESC"),
            pool.query(
                `SELECT DISTINCT p.responsable AS cd_type, concat(s.prenom, ' ', s.nom) AS libelle
                   FROM opeautres.projets p JOIN admin.salaries s ON s.cd_salarie = p.responsable
                  WHERE p.validite IS NOT FALSE ORDER BY libelle`
            ),
            pool.query("SELECT cd_type, libelle FROM ope.typ_projets WHERE cd_type <> 'TRV' ORDER BY val_tri"),
        ]);
        sendJson(res, {
            annees: annees.rows.map((r) => r.annee),
            responsables: responsables.rows,
            typ_projets: types.rows,
            statuts: STATUTS,
        });
    } catch (err) {
        sendError(res, "Erreur lors de la lecture des sélecteurs.", err);
    }
});

// ─── GET /sites/autres/projets ────────────────────────────────────────────────
// Recherche de projets. Paramètres (tous facultatifs) : annee, typ_projet, responsable, statut,
// uuid_site (projets dont une opération est localisée sur le site ; uuid du site ou de son espace), cd_localisation, texte
// (nom du projet ou détail d'une opération, sans accents), limite (500 par défaut, 2000 maxi)
router.get("/projets", async (req, res) => {
    const p = req.query;
    const annee = vide(p.annee) ? null : parseInt(p.annee, 10);
    if (annee !== null && isNaN(annee)) return res.status(400).json({ success: false, message: "annee invalide." });
    const limite = Math.min(parseInt(p.limite, 10) || 500, 2000);
    const texte = vide(p.texte) ? null : String(p.texte).trim();
    try {
        const result = await pool.query(
            `WITH sel AS (
                SELECT p.*
                  FROM opeautres.projets p
                 WHERE p.validite IS NOT FALSE
                   AND ($1::int IS NULL OR p.annee = $1)
                   AND ($2::text IS NULL OR p.typ_projet = $2)
                   AND ($3::text IS NULL OR p.responsable = $3)
                   AND ($4::text IS NULL OR p.statut = $4)
                   -- Semi-jointures IN (...) plutôt que EXISTS corrélés : pas d'index sur operations.projet
                   AND ($5::text IS NULL OR p.uuid_proj IN (
                        SELECT o.projet FROM opeautres.operations o JOIN opeautres.localisations l ON l.uuid_ope = o.uuid_ope
                         -- uuid_site accepte l'uuid du site ou celui de son espace (valeur stockée dans cd_localisation)
                         WHERE l.cd_localisation IN (SELECT espace FROM sitcenca.sites WHERE uuid_site = $5 UNION SELECT $5)))
                   AND ($6::text IS NULL OR p.uuid_proj IN (
                        SELECT o.projet FROM opeautres.operations o JOIN opeautres.localisations l ON l.uuid_ope = o.uuid_ope
                         WHERE l.cd_localisation = $6))
                   AND ($7::text IS NULL OR unaccent(p.nom) ILIKE unaccent('%' || $7 || '%') OR p.uuid_proj IN (
                        SELECT o.projet FROM opeautres.operations o
                         WHERE unaccent(o.detail) ILIKE unaccent('%' || $7 || '%')))
                 ORDER BY p.annee DESC NULLS LAST, p.date_crea DESC NULLS LAST, p.nom
                 LIMIT $8
            ), ope AS (
                SELECT o.projet, count(*) AS nb_ope, min(o.date_deb) AS date_deb, max(coalesce(o.date_fin, o.date_deb)) AS date_fin
                  FROM opeautres.operations o JOIN sel ON sel.uuid_proj = o.projet
                 GROUP BY o.projet
            ), loc AS (
                SELECT o.projet, string_agg(DISTINCT lo.libelle_loc, ' | ') AS localisations
                  FROM opeautres.operations o
                  JOIN sel ON sel.uuid_proj = o.projet
                  JOIN opeautres.localisations l ON l.uuid_ope = o.uuid_ope
                  JOIN opeautres.localisants lo ON lo.id_loc = l.cd_localisation
                 GROUP BY o.projet
            )
            SELECT sel.uuid_proj, sel.code, sel.nom, sel.annee, sel.statut, sel.typ_projet, tp.libelle AS typ_projet_libelle,
                   sel.responsable, concat(s.prenom, ' ', s.nom) AS responsable_str, sel.programme, sel.createur,
                   to_char(sel.date_crea, 'YYYY-MM-DD') AS date_crea, coalesce(ope.nb_ope, 0)::int AS nb_ope,
                   to_char(ope.date_deb, 'YYYY-MM-DD') AS date_deb, to_char(ope.date_fin, 'YYYY-MM-DD') AS date_fin, loc.localisations
              FROM sel
              LEFT JOIN ope ON ope.projet = sel.uuid_proj
              LEFT JOIN loc ON loc.projet = sel.uuid_proj
              LEFT JOIN ope.typ_projets tp ON tp.cd_type = sel.typ_projet
              LEFT JOIN admin.salaries s ON s.cd_salarie = sel.responsable
             ORDER BY sel.annee DESC NULLS LAST, sel.date_crea DESC NULLS LAST, sel.nom`,
            [annee, p.typ_projet || null, p.responsable || null, p.statut || null, p.uuid_site || null,
                p.cd_localisation || null, texte, limite]
        );
        sendJson(res, result.rows);
    } catch (err) {
        sendError(res, "Erreur lors de la recherche de projets.", err);
    }
});

// ─── GET /sites/autres/projets/:uuid ──────────────────────────────────────────
// Projet complet : champs du projet + operations[] avec localisations, cibles, indicateurs, intervenants
router.get("/projets/:uuid", async (req, res) => {
    try {
        const projet = await lireProjet(pool, req.params.uuid);
        if (!projet) return res.status(404).json({ success: false, message: "Projet introuvable." });
        sendJson(res, projet);
    } catch (err) {
        sendError(res, "Erreur lors de la lecture du projet.", err);
    }
});

// ─── GET /sites/autres/operations/:uuid ───────────────────────────────────────
router.get("/operations/:uuid", async (req, res) => {
    try {
        const operation = await lireOperation(pool, req.params.uuid);
        if (!operation) return res.status(404).json({ success: false, message: "Opération introuvable." });
        sendJson(res, operation);
    } catch (err) {
        sendError(res, "Erreur lors de la lecture de l'opération.", err);
    }
});

module.exports = router;
