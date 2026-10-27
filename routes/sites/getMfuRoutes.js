// Maîtrise foncière (MFU) : actes, parcelles, projets MFU (pmfu) et leur recherche
// Monté sur /sites dans node_base_sites.js
const express = require("express");
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const { distinctResearchRaw, executeQueryAndRespond, reset } = require("../../fonctions/fonctionsSites.js");
const pool = require("../../dbPool/poolConnect.js");

// MFU - Actes pour le site
router.get("/mfu/uuid=:uuid/:mode", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();
    mode = req.params.mode;
    message = "sites/mfu/uuid/" + mode;

    if (req.params.mode == "lite") {
        SelectFields =
            "SELECT DISTINCT nom, site, uuid_acte, debut, fin, tacit_rec, typ_mfu, url, type_prop, surf_totale, validite ";
        FromTable = "FROM sitcenca.listeallactes ";
        where =
            "where site = $1 " +
            "OR EXISTS (" +
            "    SELECT 1 " +
            "    FROM sitcenca.actes_mfu_multi amm " +
            "    WHERE amm.ref_uuid_acte = sitcenca.listeallactes.uuid_acte " +
            "      AND amm.ref_uuid_site = $1" +
            ") " +
            "order by debut;";

    } else if (req.params.mode == "full") {
        SelectFields =
            "select uuid_acte, debut, fin, tacit_rec, detail_rec, notaire, cout, remarque, amfu.validite, amfu.date_crea, date_modif, typ_mfu, site, amfu.url, e.nom as nom_site ";
        FromTable = "FROM sitcenca.actes_mfu AS amfu ";
        FromTable += "LEFT JOIN sitcenca.sites s ON amfu.site = s.uuid_site ";
        FromTable += "LEFT JOIN esp.espaces e ON s.espace = e.uuid_espace ";
        where = "where uuid_acte = $1;";
    }

    executeQueryAndRespond(
        pool,
        SelectFields,
        FromTable,
        where,
        req.params.uuid,
        res,
        message,
        mode
    ); // Retourne un ou plusieurs résultats
});

// MFU - Liste des actes avec rattachements multi-sites
router.get("/mfu/multi-sites/lite", (req, res) => {
    const sql = `
        SELECT
            amfu.uuid_acte,
            amfu.typ_mfu,
            COALESCE(tm.libelle, amfu.typ_mfu) AS typ_mfu_libelle,
            amfu.debut,
            amfu.fin,
            amfu.validite,
            amfu.site AS site_principal_uuid,
            s_principal.code AS site_principal_code,
            ep.nom || ' (' || code || ')' AS site_principal_nom,
            COALESCE(att.nb_sites, 1) AS nb_sites,
            COALESCE(att.sites_associes, ep.nom) AS sites_associes,
            COALESCE(att.sites_associes_details, '[]'::jsonb) AS sites_associes_details
        FROM sitcenca.actes_mfu amfu
        LEFT JOIN sitcenca.typ_mfu tm
            ON tm.cd_type = amfu.typ_mfu
        LEFT JOIN sitcenca.sites s_principal
            ON s_principal.uuid_site = amfu.site
        LEFT JOIN esp.espaces ep
            ON ep.uuid_espace = s_principal.espace
        LEFT JOIN LATERAL (
            SELECT
                COUNT(DISTINCT sites_union.uuid_site) AS nb_sites,
                STRING_AGG(DISTINCT sites_union.nom_site, ' | ' ORDER BY sites_union.nom_site) AS sites_associes,
                JSONB_AGG(DISTINCT jsonb_build_object('uuid_site', sites_union.uuid_site, 'nom_site', sites_union.nom_site))
                    FILTER (WHERE sites_union.uuid_site IS NOT NULL) AS sites_associes_details
            FROM (
                SELECT
                    s0.uuid_site,
                    e0.nom AS nom_site
                FROM sitcenca.sites s0
                LEFT JOIN esp.espaces e0
                    ON e0.uuid_espace = s0.espace
                WHERE s0.uuid_site = amfu.site

                UNION

                SELECT
                    s1.uuid_site,
                    e1.nom AS nom_site
                FROM sitcenca.actes_mfu_multi amm
                JOIN sitcenca.sites s1
                    ON s1.uuid_site = amm.ref_uuid_site
                LEFT JOIN esp.espaces e1
                    ON e1.uuid_espace = s1.espace
                WHERE amm.ref_uuid_acte = amfu.uuid_acte
            ) sites_union
        ) att ON TRUE
        ORDER BY amfu.debut DESC NULLS LAST;
    `;

    pool.query(sql, (err, result) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json; charset=utf-8");

        if (err) {
            console.error("Erreur SQL /mfu/multi-sites/lite:", err);
            return res.status(500).json({
                success: false,
                message: "Erreur lors de la récupération des actes multi-sites.",
                detail: err.message,
            });
        }

        return res.status(200).json(result?.rows || []);
    });
});

// MFU - Liste des sites disponibles pour rattachement multi-sites
router.get("/mfu/sites/lite", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();
    message = "sites/mfu/sites/lite";

    SelectFields = "SELECT s.uuid_site, s.code as code_site, e.nom as nom_site ";
    FromTable = "FROM sitcenca.sites s ";
    FromTable += "LEFT JOIN esp.espaces e ON s.espace = e.uuid_espace ";
    where = "WHERE s.uuid_site IS NOT NULL ORDER BY e.nom;";

    executeQueryAndRespond(
        pool,
        SelectFields,
        FromTable,
        where,
        null,
        res,
        message,
        "lite"
    );
});

// Parcelles associées à un acte MFU
router.get("/parcelles_mfu/uuid=:uuid", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();
    message = "sites/parcelles_mfu/uuid";

    SelectFields =
        "SELECT uuid_parcelle, insee, prefix, section, numero, partie, surface, validite, acte_mfu, id_source, remarque, pour_partie, typ_proprietaire, proprietaire, code_parcelle, typro.libelle as libelle, typro.libelle_court as libelle_court ";
    FromTable = "FROM sitcenca.parcelles_mfu ";
    FromTable +=
        "LEFT JOIN sitcenca.typ_proprietaires as typro ON sitcenca.parcelles_mfu.typ_proprietaire = typro.cd_type ";
    where = "where acte_mfu = $1;";

    executeQueryAndRespond(
        pool,
        SelectFields,
        FromTable,
        where,
        req.params.uuid,
        res,
        message,
        "lite"
    );
});






// PMFU Selectors de la barre de recherche des projets MFU
router.get("/selectors_pmfu", (req, res) => {
    distinctResearchRaw(
        pool, [], "pmfu_responsable", "Responsable",
        `SELECT DISTINCT left(s.prenom, 1) || ' ' || s.nom AS pmfu_responsable
         FROM sitcenca.projets_mfu p
         JOIN admin.salaries s ON p.pmfu_responsable = s.cd_salarie
         ORDER BY pmfu_responsable;`,
        (selectors) => {
            distinctResearchRaw(
                pool, selectors, "pmfu_commune_nom", "Commune",
                `SELECT DISTINCT unnest(pmfu_commune_nom) AS pmfu_commune_nom FROM sitcenca.projets_mfu
                 WHERE pmfu_commune_nom IS NOT NULL
                 ORDER BY pmfu_commune_nom;`,
                (selectors) => {
                    distinctResearchRaw(
                        pool, selectors, "type_acte", "Type d'acte",
                        `SELECT DISTINCT l.lib_libelle AS type_acte
                         FROM sitcenca.projets_mfu p
                         JOIN sitcenca.libelles l ON p.pmfu_type_acte = l.lib_id
                         ORDER BY type_acte;`,
                        (selectors) => {
                            distinctResearchRaw(
                                pool, selectors, "statut", "Statut",
                                `SELECT DISTINCT l.lib_libelle AS statut
                                 FROM sitcenca.projets_mfu p
                                 JOIN sitcenca.libelles l ON p.pmfu_status = l.lib_id
                                 ORDER BY statut;`,
                                (selectors) => {
                                    const json = JSON.stringify(selectors);
                                    res.setHeader("Access-Control-Allow-Origin", "*");
                                    res.setHeader("Content-type", "application/json; charset=UTF-8");
                                    res.end(json);
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});


// Pour récuperer les projets MFU
router.get("/pmfu/id=:id/:mode", (req, res) => {
    console.log(
        "Demande de pmfu pour l'id " +
        req.params.id +
        " et le mode " +
        req.params.mode
    );
    let { SelectFields, FromTable, where, message } = reset();
    message = "projets/pmfu/id/" + req.params.mode;
    const mode = req.params.mode;
    if (mode === "lite") {
        SelectFields = `SELECT p.pmfu_id, p.pmfu_nom, left(s.prenom, 1) || ' ' || s.nom as pmfu_responsable, p.pmfu_commune_nom, l.lib_libelle as type_acte `;
        FromTable = "FROM sitcenca.projets_mfu p ";
        FromTable += "LEFT JOIN admin.salaries s ON p.pmfu_responsable = s.cd_salarie ";
        FromTable += "LEFT JOIN sitcenca.libelles l ON p.pmfu_type_acte = l.lib_id;";
        where = "";
        req.params.id = null;
    } else if (mode === "full") {
        SelectFields = 'SELECT p.pmfu_id, p.pmfu_nom, p.pmfu_responsable, p.pmfu_createur, p.pmfu_agence, p.pmfu_associe, p.pmfu_proch_etape, p.pmfu_dep, p.pmfu_territoire, ';
        SelectFields += 'p.pmfu_type_acte, p.pmfu_commune_insee, p.pmfu_commune_nom, p.pmfu_annee_debut, p.pmfu_proprietaire, p.pmfu_appui, p.pmfu_appui_desc, p.pmfu_quest_juri, p.pmfu_validation, ';
        SelectFields += 'p.pmfu_mes_comp, p.pmfu_cout, p.pmfu_financements, p.pmfu_surf_cadastrale, p.pmfu_surf_mfu, p.pmfu_priorite, p.pmfu_status, p.pmfu_annee_signature, p.pmfu_echeances, p.pmfu_creation, ';
        SelectFields += 'p.pmfu_derniere_maj, COUNT(*) FILTER (WHERE d.doc_type = 1) AS photos_site_nb, ';
        SelectFields += 'COUNT(*) FILTER (WHERE d.doc_type = 2) AS projet_acte_nb, COUNT(*) FILTER (WHERE d.doc_type = 3) AS decision_bureau_nb, COUNT(*) FILTER (WHERE d.doc_type = 4) AS note_bureau_nb, pmfu_parc_list ';
        FromTable = `FROM sitcenca.projets_mfu p `
        FromTable += `LEFT JOIN files.docs d ON p.pmfu_id::character varying = d.ref_id `;
        where = `WHERE pmfu_id = $1 GROUP BY p.pmfu_id;`;
        req.params.id = parseInt(req.params.id);
    }

    executeQueryAndRespond(
        pool,
        SelectFields,
        FromTable,
        where,
        req.params.id,
        res,
        message,
        mode
    );
});


module.exports = router;
