"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../../dbPool/poolConnect.js");

// Helper réponse JSON standard
function sendJson(res, rows) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).json(rows);
}

function sendError(res, message, err) {
    console.error(`[chiro] ${message}`, err?.message || err);
    res.status(500).json({ success: false, message, detail: err?.message, hint: err?.hint, position: err?.position });
}

// ─── A1. GET /chiro/releves ──────────────────────────────────────────────────
// Liste paginée et filtrable (commune, site, annee, espece)
router.get("/releves", async (req, res) => {
    const { commune, site, annee, espece } = req.query;

    try {
        let result;
        if (espece) {
            // Jointure observations nécessaire pour filtrer par espèce
            const sql = `
                SELECT lr.*
                FROM chiro.liste_releves lr
                JOIN chiro.observations o ON o.releve = lr.uuid_releve
                WHERE ($1::varchar IS NULL OR lr.insee = $1)
                  AND ($2::integer IS NULL OR lr.id_site = $2)
                  AND ($3::text IS NULL OR EXTRACT(YEAR FROM lr.date_releve)::text = $3)
                  AND ($4::varchar IS NULL OR o.espece = $4)
                GROUP BY lr.uuid_releve, lr.insee, lr.commune, lr.site, lr.date_releve,
                         lr.orga, lr.nbesp, lr.nbobs, lr.id_site, lr.geom,
                         lr.code_site_chiro, lr.nom_site
                ORDER BY lr.date_releve DESC
                LIMIT 500
            `;
            result = await pool.query(sql, [commune || null, site ? parseInt(site) : null, annee || null, espece]);
        } else {
            // Pas de filtre espèce : version simplifiée
            const conditions = [];
            const values = [];
            let i = 1;

            if (commune) { conditions.push(`insee = $${i++}`); values.push(commune); }
            if (site)    { conditions.push(`id_site = $${i++}`); values.push(parseInt(site)); }
            if (annee)   { conditions.push(`EXTRACT(YEAR FROM date_releve)::text = $${i++}`); values.push(annee); }

            const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
            const sql = `SELECT * FROM chiro.liste_releves ${where} ORDER BY date_releve DESC LIMIT 500`;
            result = await pool.query(sql, values);
        }
        sendJson(res, result.rows);
    } catch (err) {
        sendError(res, "Erreur lors de la récupération des relevés.", err);
    }
});

// ─── A2. GET /chiro/releve/:uuid ─────────────────────────────────────────────
// Détail d'un relevé (en-tête + protocole + localisation)
router.get("/releve/:uuid", async (req, res) => {
    const sql = `
        SELECT r.*,
               s.nom        AS nom_site,
               s.code       AS code_site,
               c.nom        AS commune_nom,
               prog.nom_programme AS programme_nom
        FROM chiro.releves r
        LEFT JOIN chiro.sites       s    ON r.site           = s.id_site
        LEFT JOIN chiro.communes    c    ON r.insee           = c.insee
        LEFT JOIN chiro.programmes  prog ON r.programme = prog.uuid_programme
        WHERE r.uuid_releve = $1
    `;
    try {
        const result = await pool.query(sql, [req.params.uuid]);
        if (!result.rows.length) return res.status(404).json({ success: false, message: "Relevé introuvable." });
        sendJson(res, result.rows[0]);
    } catch (err) {
        sendError(res, "Erreur lors de la récupération du relevé.", err);
    }
});

// ─── A3. GET /chiro/releve/:uuid/observations ─────────────────────────────────
// Observations d'un relevé avec labels résolus
router.get("/releve/:uuid/observations", async (req, res) => {
    const sql = `
        SELECT
            o.uuid_observation,
            o.espece            AS cd_espece,
            e.nom               AS espece_nom,
            o.nombre,
            o.type_observation,
            to2.libelle         AS type_obs_libelle,
            o.denombrement,
            td.libelle          AS denombrement_libelle,
            o.objet,
            tobj.libelle        AS objet_libelle,
            o.methode,
            tm.libelle          AS methode_libelle,
            o.statut_biologique,
            tsb.libelle         AS statut_bio_libelle,
            o.stade,
            ts.libelle          AS stade_libelle,
            o.sexe,
            tsx.libelle         AS sexe_libelle,
            o.etat_bio,
            teb.libelle         AS etat_bio_libelle,
            o.commentaire,
            m.cause             AS mortalite_cause,
            m.test_rabique,
            m.resultat          AS resultat_test,
            b.nb_biometries
        FROM chiro.observations o
        LEFT JOIN chiro.especes           e    ON o.espece            = e.cd_espece
        LEFT JOIN chiro.typ_observations  to2  ON o.type_observation  = to2.cd_type
        LEFT JOIN chiro.typ_denombrements td   ON o.denombrement      = td.cd_denombrement
        LEFT JOIN chiro.typ_objets        tobj ON o.objet             = tobj.cd_objet
        LEFT JOIN chiro.typ_methodes      tm   ON o.methode           = tm.cd_methode
        LEFT JOIN chiro.typ_statuts_bio   tsb  ON o.statut_biologique = tsb.cd_statut_bio
        LEFT JOIN chiro.typ_stades        ts   ON o.stade             = ts.cd_stade
        LEFT JOIN chiro.typ_sexes         tsx  ON o.sexe              = tsx.cd_sexe
        LEFT JOIN chiro.typ_etats_bio     teb  ON o.etat_bio          = teb.cd_etat_bio
        LEFT JOIN chiro.mortalites        m    ON o.uuid_observation  = m.observation
        LEFT JOIN (
            SELECT observation, COUNT(*) AS nb_biometries
            FROM chiro.biometries GROUP BY observation
        ) b ON o.uuid_observation = b.observation
        WHERE o.releve = $1
        ORDER BY e.nom
    `;
    try {
        const result = await pool.query(sql, [req.params.uuid]);
        sendJson(res, result.rows);
    } catch (err) {
        sendError(res, "Erreur lors de la récupération des observations.", err);
    }
});

// ─── A7. GET /chiro/sites/geojson ────────────────────────────────────────────
// GeoJSON des sites pour la carte Leaflet (AVANT /site/:id)
router.get("/sites/geojson", async (req, res) => {
    const sql = `
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(json_agg(
                json_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(l.geom)::json,
                    'properties', json_build_object(
                        'id_site',   s.id_site,
                        'nom',       s.nom,
                        'code',      s.code,
                        'type_site', ls.type_site,
                        'nbrel',     ls.nbrel,
                        'nbobs',     ls.nbobs
                    )
                )
            ) FILTER (WHERE l.geom IS NOT NULL), '[]')
        ) AS geojson
        FROM chiro.localisations l
        JOIN chiro.sites       s  ON l.site    = s.id_site
        JOIN chiro.liste_sites ls ON s.id_site = ls.id_site
        WHERE l.geom IS NOT NULL
    `;
    try {
        const result = await pool.query(sql);
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.status(200).json(result.rows[0]?.geojson || { type: "FeatureCollection", features: [] });
    } catch (err) {
        sendError(res, "Erreur lors de la récupération du GeoJSON des sites.", err);
    }
});

// ─── A4. GET /chiro/sites ─────────────────────────────────────────────────────
// Liste des sites avec coordonnées WGS84 pour les markers carte
router.get("/sites", async (req, res) => {
    const sql = `
        SELECT DISTINCT ON (ls.id_site) ls.*,
            ST_X(ST_Transform(l.geom, 4326)) AS wgs84_x,
            ST_Y(ST_Transform(l.geom, 4326)) AS wgs84_y
        FROM chiro.liste_sites ls
        LEFT JOIN chiro.localisations l ON ls.id_site = l.site
        ORDER BY ls.id_site, l.id_localisation
    `;
    try {
        const result = await pool.query(sql);
        sendJson(res, result.rows);
    } catch (err) {
        sendError(res, "Erreur lors de la récupération des sites.", err);
    }
});

// ─── A5. GET /chiro/site/:id ──────────────────────────────────────────────────
// Détail d'un site
router.get("/site/:id", async (req, res) => {
    const sql = `
        SELECT s.*,
               tn.libelle   AS nature_libelle,
               th.libelle   AS habitat_libelle,
               tp.libelle   AS periode_libelle,
               tc.libelle   AS configuration_libelle,
               td.libelle   AS definition_libelle,
               array_agg(DISTINCT c.nom)    FILTER (WHERE c.nom   IS NOT NULL) AS communes,
               array_agg(DISTINCT cs.insee) FILTER (WHERE cs.insee IS NOT NULL) AS insees,
               MIN(ST_X(ST_Transform(l.geom, 4326))) AS wgs84_x,
               MIN(ST_Y(ST_Transform(l.geom, 4326))) AS wgs84_y,
               MIN(l.x)                               AS x_lambert,
               MIN(l.y)                               AS y_lambert,
               MIN(l.type)                            AS type_localisation,
               MIN(l.pointage)                        AS pointage_loc,
               MIN(l."precision")                     AS precision_loc
        FROM chiro.sites s
        LEFT JOIN chiro.typ_natures        tn ON s.nature        = tn.cd_nature
        LEFT JOIN chiro.typ_habitats       th ON s.habitat::varchar = th.cd_habitat
        LEFT JOIN chiro.typ_periodes       tp ON s.periode        = tp.cd_periode
        LEFT JOIN chiro.typ_configurations tc ON s.configuration  = tc.cd_configuration
        LEFT JOIN chiro.typ_definitions    td ON s.definition     = td.cd_definition
        LEFT JOIN chiro.communes_sites     cs ON s.id_site        = cs.site
        LEFT JOIN chiro.communes           c  ON cs.insee         = c.insee
        LEFT JOIN chiro.localisations      l  ON l.site           = s.id_site
        WHERE s.id_site = $1
        GROUP BY s.id_site, tn.libelle, th.libelle, tp.libelle, tc.libelle, td.libelle
    `;
    try {
        const result = await pool.query(sql, [parseInt(req.params.id)]);
        if (!result.rows.length) return res.status(404).json({ success: false, message: "Site introuvable." });
        sendJson(res, result.rows[0]);
    } catch (err) {
        sendError(res, "Erreur lors de la récupération du site.", err);
    }
});

// ─── A6. GET /chiro/site/:id/releves ─────────────────────────────────────────
// Relevés liés à un site
router.get("/site/:id/releves", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT lr.* FROM chiro.liste_releves lr WHERE lr.id_site = $1 ORDER BY lr.date_releve DESC",
            [parseInt(req.params.id)]
        );
        sendJson(res, result.rows);
    } catch (err) {
        sendError(res, "Erreur lors de la récupération des relevés du site.", err);
    }
});

// ─── C1. GET /chiro/typologies ───────────────────────────────────────────────
// Toutes les listes de référence regroupées pour alimenter les <mat-select>
router.get("/typologies", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 'type_observation' AS groupe, cd_type         AS code, libelle FROM chiro.typ_observations
            UNION ALL SELECT 'denombrement',     cd_denombrement,          libelle FROM chiro.typ_denombrements
            UNION ALL SELECT 'objet',            cd_objet,                 libelle FROM chiro.typ_objets
            UNION ALL SELECT 'methode',          cd_methode,               libelle FROM chiro.typ_methodes
            UNION ALL SELECT 'statut_bio',       cd_statut_bio,            libelle FROM chiro.typ_statuts_bio
            UNION ALL SELECT 'stade',            cd_stade,                 libelle FROM chiro.typ_stades
            UNION ALL SELECT 'sexe',             cd_sexe,                  libelle FROM chiro.typ_sexes
            UNION ALL SELECT 'etat_bio',         cd_etat_bio,              libelle FROM chiro.typ_etats_bio
            UNION ALL SELECT 'mortalite_cause',  cd_cause,                 libelle FROM chiro.typ_causes
            UNION ALL SELECT 'definition',       cd_definition,            libelle FROM chiro.typ_definitions
            UNION ALL SELECT 'nature',           cd_nature,                libelle FROM chiro.typ_natures
            UNION ALL SELECT 'configuration',    cd_configuration,         libelle FROM chiro.typ_configurations
            UNION ALL SELECT 'periode',          cd_periode,               libelle FROM chiro.typ_periodes
            UNION ALL SELECT 'habitat',          cd_habitat::text,         libelle FROM chiro.typ_habitats
            UNION ALL SELECT 'coordonnee',       cd_type::text,            libelle FROM chiro.typ_coordonnees
            UNION ALL SELECT 'pointage',         id_pointage::text,        libelle FROM chiro.typ_pointages
            UNION ALL SELECT 'precision',        cd_precision::text,       libelle FROM chiro.typ_precisions
            ORDER BY groupe, libelle
        `);
        const grouped = {};
        for (const row of result.rows) {
            if (!grouped[row.groupe]) grouped[row.groupe] = [];
            grouped[row.groupe].push({ code: row.code, libelle: row.libelle });
        }
        res.json(grouped);
    } catch (err) {
        console.error("[chiro] Erreur lors de la récupération des typologies.", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── A8. GET /chiro/communes ──────────────────────────────────────────────────
// Pour les listes déroulantes de filtre
router.get("/communes", async (req, res) => {
    try {
        const result = await pool.query("SELECT insee, nom FROM chiro.communes ORDER BY nom");
        sendJson(res, result.rows);
    } catch (err) {
        sendError(res, "Erreur lors de la récupération des communes.", err);
    }
});

// ─── A9. GET /chiro/especes ───────────────────────────────────────────────────
// Pour les listes déroulantes
router.get("/especes", async (req, res) => {
    try {
        const result = await pool.query("SELECT cd_espece, nom FROM chiro.especes ORDER BY nom");
        sendJson(res, result.rows);
    } catch (err) {
        sendError(res, "Erreur lors de la récupération des espèces.", err);
    }
});

module.exports = router;
