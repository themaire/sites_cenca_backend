"use strict";

// Projets « autres » : création et modification (projets, opérations et leurs listes rattachées).
// Monté sur /sites/autres dans node_base_sites.js. Modèle de données : fonctions/projetsAutres.js
const express = require("express");
const router = express.Router();
const pool = require("../../dbPool/poolConnect.js");
const { authenticateToken } = require("../../fonctions/fonctionsAuth.js");
const { lireProjet, lireOperation, codeSalarie, verifierProjet, verifierOperation, ecrireListesOperation, journaliser, vide } = require("../../fonctions/projetsAutres.js");

function sendJson(res, data, status = 200) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(status).json(data);
}

function sendError(res, message, err) {
    console.error(`[projets autres] ${message}`, err?.message || err);
    res.status(500).json({ success: false, message, detail: err?.message, hint: err?.hint });
}

const refuser = (res, erreurs) => res.status(400).json({ success: false, message: "Données invalides.", erreurs });

// Champs d'une opération (hors listes rattachées) modifiables par PUT
const CHAMPS_OPERATION = ["action", "date_deb", "date_fin", "detail", "typ_interv", "com_interv"];
const CHAMPS_PROJET = ["nom", "typ_projet", "annee", "statut", "responsable", "programme"];

// Exécute fn(client) dans une transaction
async function enTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const resultat = await fn(client);
        await client.query("COMMIT");
        return resultat;
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

// Insère une opération et ses listes, journalisées pour compte ; renvoie son uuid
async function insererOperation(client, uuidProj, corps, compte) {
    const result = await client.query(
        `INSERT INTO opeautres.operations (uuid_ope, projet, action, date_deb, date_fin, detail, typ_interv, com_interv, validite)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, true)
         RETURNING uuid_ope`,
        [uuidProj, corps.action, corps.date_deb || null, corps.date_fin || null, vide(corps.detail) ? null : corps.detail,
            corps.typ_interv || null, vide(corps.com_interv) ? null : corps.com_interv]
    );
    const uuidOpe = result.rows[0].uuid_ope;
    await journaliser(client, compte, "opeautres.operations", uuidOpe, "INSERT");
    await ecrireListesOperation(client, uuidOpe, corps, compte);
    return uuidOpe;
}

// Toutes les routes ci-dessous exigent un JWT (authenticateToken par route, et non router.use :
// une URL inconnue sous /sites/autres doit répondre 404, pas 401)

// ─── POST /sites/autres/projets ───────────────────────────────────────────────
// Crée un projet. Corps : { nom, typ_projet, annee, statut?, responsable?, programme?, operations?: [...] }
// createur = salarié connecté ; code = type + créateur + date, comme l'interface MS Access (ex. SENVGS15/10/2026)
router.post("/projets", authenticateToken, async (req, res) => {
    const corps = req.body || {};
    try {
        const erreurs = await verifierProjet(pool, corps);
        if (Array.isArray(corps.operations))
            for (const [i, ope] of corps.operations.entries())
                erreurs.push(...(await verifierOperation(pool, ope)).map((e) => `operations[${i}] : ${e}`));
        if (erreurs.length) return refuser(res, erreurs);

        const createur = await codeSalarie(pool, req.tokenInfos?.identifiant);
        const uuidProj = await enTransaction(async (client) => {
            const result = await client.query(
                `INSERT INTO opeautres.projets (uuid_proj, code, validite, programme, nom, annee, statut, responsable, typ_projet, createur, date_crea)
                 VALUES (gen_random_uuid()::text, $1 || coalesce($2, '') || to_char(current_date, 'DD/MM/YYYY'), true,
                         $3, $4, $5, $6, $7, $1, $2, current_date)
                 RETURNING uuid_proj`,
                [corps.typ_projet, createur, corps.programme || null, corps.nom, parseInt(corps.annee, 10),
                    corps.statut || "En cours", corps.responsable || createur]
            );
            const uuid = result.rows[0].uuid_proj;
            await journaliser(client, createur, "opeautres.projets", uuid, "INSERT");
            for (const ope of corps.operations || []) await insererOperation(client, uuid, ope, createur);
            return uuid;
        });
        sendJson(res, { success: true, uuid_proj: uuidProj, projet: await lireProjet(pool, uuidProj) }, 201);
    } catch (err) {
        sendError(res, "Erreur lors de la création du projet.", err);
    }
});

// ─── PUT /sites/autres/projets/:uuid ──────────────────────────────────────────
// Modifie les champs fournis du projet (nom, typ_projet, annee, statut, responsable, programme)
router.put("/projets/:uuid", authenticateToken, async (req, res) => {
    const corps = req.body || {};
    const champs = CHAMPS_PROJET.filter((c) => corps[c] !== undefined);
    if (!champs.length) return refuser(res, ["aucun champ à modifier (" + CHAMPS_PROJET.join(", ") + ")"]);
    try {
        const erreurs = await verifierProjet(pool, corps, true);
        if (erreurs.length) return refuser(res, erreurs);
        const valeurs = champs.map((c) => (c === "annee" ? parseInt(corps[c], 10) : vide(corps[c]) ? null : corps[c]));
        const compte = await codeSalarie(pool, req.tokenInfos?.identifiant);
        const trouve = await enTransaction(async (client) => {
            const result = await client.query(
                `UPDATE opeautres.projets SET ${champs.map((c, i) => `${c} = $${i + 1}`).join(", ")}
                  WHERE uuid_proj = $${champs.length + 1} RETURNING uuid_proj`,
                [...valeurs, req.params.uuid]
            );
            if (result.rows.length) await journaliser(client, compte, "opeautres.projets", req.params.uuid, "UPDATE");
            return result.rows.length > 0;
        });
        if (!trouve) return res.status(404).json({ success: false, message: "Projet introuvable." });
        sendJson(res, { success: true, uuid_proj: req.params.uuid, projet: await lireProjet(pool, req.params.uuid) });
    } catch (err) {
        sendError(res, "Erreur lors de la modification du projet.", err);
    }
});

// ─── POST /sites/autres/projets/:uuid/operations ──────────────────────────────
// Ajoute une opération au projet. Corps : { action, date_deb?, date_fin?, detail?, typ_interv?, com_interv?,
//   localisations?: ["<cd_localisation>"], cibles?: [{ typ_cible, detail? }],
//   indicateurs?: [{ typ_indicateur, evaluation }], intervenants?: [{ typ_role, intervenant }] }
router.post("/projets/:uuid/operations", authenticateToken, async (req, res) => {
    const corps = req.body || {};
    try {
        const projet = await pool.query("SELECT 1 FROM opeautres.projets WHERE uuid_proj = $1", [req.params.uuid]);
        if (!projet.rows.length) return res.status(404).json({ success: false, message: "Projet introuvable." });
        const erreurs = await verifierOperation(pool, corps);
        if (erreurs.length) return refuser(res, erreurs);
        const compte = await codeSalarie(pool, req.tokenInfos?.identifiant);
        const uuidOpe = await enTransaction((client) => insererOperation(client, req.params.uuid, corps, compte));
        sendJson(res, { success: true, uuid_ope: uuidOpe, operation: await lireOperation(pool, uuidOpe) }, 201);
    } catch (err) {
        sendError(res, "Erreur lors de la création de l'opération.", err);
    }
});

// ─── PUT /sites/autres/operations/:uuid ───────────────────────────────────────
// Modifie les champs fournis de l'opération ; chaque liste fournie (localisations, cibles, indicateurs,
// intervenants) remplace entièrement l'ancienne, une liste absente n'est pas modifiée
router.put("/operations/:uuid", authenticateToken, async (req, res) => {
    const corps = req.body || {};
    const champs = CHAMPS_OPERATION.filter((c) => corps[c] !== undefined);
    try {
        const existe = await pool.query("SELECT 1 FROM opeautres.operations WHERE uuid_ope = $1", [req.params.uuid]);
        if (!existe.rows.length) return res.status(404).json({ success: false, message: "Opération introuvable." });
        const erreurs = await verifierOperation(pool, corps, true);
        if (erreurs.length) return refuser(res, erreurs);
        const compte = await codeSalarie(pool, req.tokenInfos?.identifiant);
        await enTransaction(async (client) => {
            if (champs.length) {
                await client.query(
                    `UPDATE opeautres.operations SET ${champs.map((c, i) => `${c} = $${i + 1}`).join(", ")}
                      WHERE uuid_ope = $${champs.length + 1}`,
                    [...champs.map((c) => (vide(corps[c]) ? null : corps[c])), req.params.uuid]
                );
                await journaliser(client, compte, "opeautres.operations", req.params.uuid, "UPDATE");
            }
            await ecrireListesOperation(client, req.params.uuid, corps, compte);
        });
        sendJson(res, { success: true, uuid_ope: req.params.uuid, operation: await lireOperation(pool, req.params.uuid) });
    } catch (err) {
        sendError(res, "Erreur lors de la modification de l'opération.", err);
    }
});

// ─── POST /sites/autres/operations/:uuid/clone ────────────────────────────────
// Duplique une opération (avec ses listes) dans le même projet, ou dans { projet } si fourni.
// Les dates peuvent être remplacées : { date_deb?, date_fin? } (ex. animation répétée)
router.post("/operations/:uuid/clone", authenticateToken, async (req, res) => {
    const corps = req.body || {};
    try {
        const source = await lireOperation(pool, req.params.uuid);
        if (!source) return res.status(404).json({ success: false, message: "Opération introuvable." });
        const uuidProj = corps.projet || source.uuid_proj;
        if (corps.projet) {
            const projet = await pool.query("SELECT 1 FROM opeautres.projets WHERE uuid_proj = $1", [uuidProj]);
            if (!projet.rows.length) return res.status(404).json({ success: false, message: "Projet cible introuvable." });
        }
        const copie = {
            action: source.action,
            date_deb: corps.date_deb !== undefined ? corps.date_deb : source.date_deb,
            date_fin: corps.date_fin !== undefined ? corps.date_fin : source.date_fin,
            detail: source.detail, typ_interv: source.typ_interv, com_interv: source.com_interv,
            localisations: source.localisations.map((l) => l.cd_localisation),
            cibles: source.cibles.map(({ typ_cible, detail }) => ({ typ_cible, detail })),
            indicateurs: source.indicateurs.map(({ typ_indicateur, evaluation }) => ({ typ_indicateur, evaluation })),
            intervenants: source.intervenants.map(({ typ_role, intervenant }) => ({ typ_role, intervenant })),
        };
        const erreurs = [];
        for (const [nom, d] of [["date_deb", corps.date_deb], ["date_fin", corps.date_fin]])
            if (!vide(d) && isNaN(Date.parse(d))) erreurs.push(nom + " invalide (AAAA-MM-JJ)");
        if (erreurs.length) return refuser(res, erreurs);
        const compte = await codeSalarie(pool, req.tokenInfos?.identifiant);
        const uuidOpe = await enTransaction((client) => insererOperation(client, uuidProj, copie, compte));
        sendJson(res, { success: true, uuid_ope: uuidOpe, operation: await lireOperation(pool, uuidOpe) }, 201);
    } catch (err) {
        sendError(res, "Erreur lors de la duplication de l'opération.", err);
    }
});

module.exports = router;
