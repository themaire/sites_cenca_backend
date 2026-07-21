"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../../dbPool/poolConnect.js");
const { authenticateToken } = require("../../fonctions/fonctionsAuth.js");

// Toutes les routes PUT/POST chiro nécessitent une authentification
router.use(authenticateToken);

function sendJson(res, data, status = 200) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(status).json(data);
}

function sendError(res, message, err) {
    console.error(`[chiro] ${message}`, err?.message || err);
    res.status(500).json({ success: false, message, detail: err?.message, hint: err?.hint, position: err?.position });
}

// ─── E2. POST /chiro/site ────────────────────────────────────────────────────
// Créer un nouveau site (+ commune + localisation optionnelle)
router.post("/site", async (req, res) => {
    const {
        code, nom, nature, definition, configuration, habitat, periode,
        localisation, contact, proprietaire, type_proprietaire, description, interet,
        accessibilite, protection, date_protection, suivi_prc, priorisation,
        insee, lat, lng, x_lambert, y_lambert
    } = req.body;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const idRes = await client.query(
            "SELECT COALESCE(MAX(id_site), 0) + 1 AS next_id FROM chiro.sites"
        );
        const id_site = idRes.rows[0].next_id;

        await client.query(`
            INSERT INTO chiro.sites
                (id_site, code, nom, nature, definition, configuration, habitat, periode,
                 localisation, contact, proprietaire, type_proprietaire, description, interet,
                 accessibilite, protection, date_protection, suivi_prc, priorisation, date_creation)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
        `, [
            id_site, code, nom,
            nature || null, definition || null, configuration || null,
            habitat || null, periode || null,
            localisation || null, contact || null, proprietaire || null, type_proprietaire || null,
            description || null, interet || null,
            accessibilite ?? false, protection ?? false, date_protection || null,
            suivi_prc ?? false, priorisation ?? false
        ]);

        await client.query(
            "INSERT INTO chiro.communes_sites (site, insee) VALUES ($1,$2)",
            [id_site, insee]
        );

        if (lat && lng) {
            // Coordonnées carte : WGS84 → Lambert 93
            await client.query(`
                INSERT INTO chiro.localisations (site, geom)
                VALUES ($1, ST_Transform(ST_SetSRID(ST_MakePoint($2, $3), 4326), 2154))
            `, [id_site, lng, lat]);
        } else if (x_lambert && y_lambert) {
            // Coordonnées manuelles : déjà en Lambert 93
            await client.query(`
                INSERT INTO chiro.localisations (site, geom)
                VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 2154))
            `, [id_site, x_lambert, y_lambert]);
        }

        await client.query("COMMIT");
        res.json({ success: true, id_site });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("[chiro] Erreur création site", err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ─── E3. PUT /chiro/site/:id ──────────────────────────────────────────────────
// Modifier un site (+ remplacement de la localisation si coordonnées fournies)
router.put("/site/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const {
        code, nom, nature, definition, configuration, habitat, periode,
        localisation, contact, proprietaire, type_proprietaire, description, interet,
        accessibilite, protection, date_protection, suivi_prc, priorisation,
        insee, lat, lng, x_lambert, y_lambert
    } = req.body;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        await client.query(`
            UPDATE chiro.sites
            SET code              = $1,
                nom               = $2,
                nature            = $3,
                definition        = $4,
                configuration     = $5,
                habitat           = $6,
                periode           = $7,
                localisation      = $8,
                contact           = $9,
                proprietaire      = $10,
                type_proprietaire = $11,
                description       = $12,
                interet           = $13,
                accessibilite     = $14,
                protection        = $15,
                date_protection   = $16,
                suivi_prc         = $17,
                priorisation      = $18
            WHERE id_site = $19
        `, [
            code, nom, nature || null, definition || null, configuration || null, habitat || null,
            periode || null, localisation || null, contact || null, proprietaire || null,
            type_proprietaire || null, description || null, interet || null,
            accessibilite || false, protection || false, date_protection || null,
            suivi_prc || false, priorisation || false, id
        ]);

        if ((lat && lng) || (x_lambert && y_lambert)) {
            await client.query("DELETE FROM chiro.localisations WHERE site = $1", [id]);
        }
        if (lat && lng) {
            // Coordonnées carte : WGS84 → Lambert 93
            await client.query(`
                INSERT INTO chiro.localisations (site, geom)
                VALUES ($1, ST_Transform(ST_SetSRID(ST_MakePoint($2, $3), 4326), 2154))
            `, [id, lng, lat]);
        } else if (x_lambert && y_lambert) {
            // Coordonnées manuelles : déjà en Lambert 93
            await client.query(`
                INSERT INTO chiro.localisations (site, geom)
                VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 2154))
            `, [id, x_lambert, y_lambert]);
        }

        await client.query("COMMIT");
        res.json({ ok: true });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("[chiro] Erreur MAJ site", err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ─── C2. POST /chiro/releve ───────────────────────────────────────────────────
// Créer un nouveau relevé
router.post("/releve", async (req, res) => {
    const {
        date_releve, insee, site, observateur_cite, habitat,
        programme, precision_loc, x, y, commentaire
    } = req.body;
    const compte_saisie = req.tokenInfos?.login ?? req.tokenInfos?.username ?? null;

    const sql = `
        INSERT INTO chiro.releves
            (uuid_releve, date_releve, insee, site, observateur_cite, habitat,
             programme, precision_loc, x, y, commentaire, compte_saisie, date_saisie)
        VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
        RETURNING uuid_releve
    `;
    try {
        const result = await pool.query(sql, [
            date_releve, insee, site, observateur_cite, habitat,
            programme, precision_loc, x, y, commentaire, compte_saisie
        ]);
        sendJson(res, result.rows[0], 201);
    } catch (err) {
        sendError(res, "Erreur lors de la création du relevé.", err);
    }
});

// ─── C3. PUT /chiro/releve/:uuid ─────────────────────────────────────────────
// Modifier un relevé existant
router.put("/releve/:uuid", async (req, res) => {
    const {
        date_releve, insee, site, observateur_cite, habitat,
        programme, precision_loc, x, y, commentaire
    } = req.body;

    const sql = `
        UPDATE chiro.releves
        SET date_releve      = $1,
            insee            = $2,
            site             = $3,
            observateur_cite = $4,
            habitat          = $5,
            programme        = $6,
            precision_loc    = $7,
            x                = $8,
            y                = $9,
            commentaire      = $10
        WHERE uuid_releve = $11
        RETURNING uuid_releve
    `;
    try {
        const result = await pool.query(sql, [
            date_releve, insee, site, observateur_cite, habitat,
            programme, precision_loc, x, y, commentaire,
            req.params.uuid
        ]);
        if (!result.rows.length) return res.status(404).json({ success: false, message: "Relevé introuvable." });
        sendJson(res, { success: true, uuid_releve: result.rows[0].uuid_releve });
    } catch (err) {
        sendError(res, "Erreur lors de la modification du relevé.", err);
    }
});

// ─── C5. POST /chiro/releve/:uuid/observation ─────────────────────────────────
// Ajouter une observation (+ mortalite si présente)
router.post("/releve/:uuid/observation", async (req, res) => {
    const {
        espece, nombre, type_observation, denombrement,
        objet, methode, statut_biologique, stade, sexe, etat_bio, commentaire,
        mortalite_cause, test_rabique, resultat_test
    } = req.body;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const obsResult = await client.query(`
            INSERT INTO chiro.observations
                (uuid_observation, releve, espece, nombre, type_observation, denombrement,
                 objet, methode, statut_biologique, stade, sexe, etat_bio, commentaire)
            VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            RETURNING uuid_observation
        `, [
            req.params.uuid, espece, nombre, type_observation, denombrement,
            objet, methode, statut_biologique, stade, sexe, etat_bio, commentaire
        ]);

        const uuid_observation = obsResult.rows[0].uuid_observation;

        if (mortalite_cause) {
            await client.query(`
                INSERT INTO chiro.mortalites (uuid_mortalite, observation, cause, test_rabique, resultat)
                VALUES (gen_random_uuid(), $1,$2,$3,$4)
            `, [uuid_observation, mortalite_cause, test_rabique ?? null, resultat_test ?? null]);
        }

        await client.query("COMMIT");
        sendJson(res, { success: true, uuid_observation }, 201);
    } catch (err) {
        await client.query("ROLLBACK");
        sendError(res, "Erreur lors de l'ajout de l'observation.", err);
    } finally {
        client.release();
    }
});

// ─── C6. PUT /chiro/observation/:uuid ────────────────────────────────────────
// Modifier une observation + DELETE/INSERT sur mortalite (pas de contrainte UNIQUE)
router.put("/observation/:uuid", async (req, res) => {
    const { uuid } = req.params;
    const {
        espece, nombre, type_observation, denombrement,
        objet, methode, statut_biologique, stade, sexe, etat_bio, commentaire,
        mortalite_cause, test_rabique, resultat_test
    } = req.body;

    try {
        await pool.query(`
            UPDATE chiro.observations
            SET espece            = $1,
                nombre            = $2,
                type_observation  = $3,
                denombrement      = $4,
                objet             = $5,
                methode           = $6,
                statut_biologique = $7,
                stade             = $8,
                sexe              = $9,
                etat_bio          = $10,
                commentaire       = $11
            WHERE uuid_observation = $12
        `, [
            espece, nombre, type_observation || null, denombrement || null, objet || null,
            methode || null, statut_biologique || null, stade || null, sexe || null,
            etat_bio || null, commentaire || null, uuid
        ]);

        await pool.query("DELETE FROM chiro.mortalites WHERE observation = $1", [uuid]);
        if (mortalite_cause) {
            await pool.query(`
                INSERT INTO chiro.mortalites (uuid_mortalite, observation, cause, test_rabique, resultat)
                VALUES (gen_random_uuid(), $1,$2,$3,$4)
            `, [uuid, mortalite_cause, test_rabique || false, resultat_test || null]);
        }

        res.json({ ok: true });
    } catch (err) {
        console.error("[chiro] Erreur MAJ observation", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
