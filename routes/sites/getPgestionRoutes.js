// Plans de gestion (docplan) : documents, unités de gestion, entités cohérentes, recherche
// Monté sur /sites dans node_base_sites.js
const express = require("express");
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const { ExecuteQuerySite, distinctResearchRaw, executeQueryAndRespond, reset } = require("../../fonctions/fonctionsSites.js");
const pool = require("../../dbPool/poolConnect.js");

// Plans de gestion
router.get("/pgestion/uuid=:uuid", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();
    message = "sites/pgestion/uuid";

    SelectFields = "SELECT ";
    SelectFields +=
        "uuid_doc, document, annee_deb, annee_fin, docactuel, url, surface ";
    FromTable = "FROM docplan.docplanifsites ";
    where = "where uuid_site = $1 order by docactuel";

    executeQueryAndRespond(
        pool,
        SelectFields,
        FromTable,
        where,
        req.params.uuid,
        res,
        message,
        (mode = "lite")
    ); // Retourne plusieurs résultats
});

// Fiche complète d'un document planificateur
router.get("/pgestion/doc/uuid=:uuid_doc", (req, res) => {
    const queryObject = {
        text: `SELECT uuid_doc, nom, surface, annee_deb, annee_fin, validite, url,
                      site, entite_coherente, typ_document, actuel, evaluation
               FROM docplan.documents
               WHERE uuid_doc = $1;`,
        values: [req.params.uuid_doc]
    };
    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "sites/pgestion/doc/uuid" },
        "select",
        (resultats, message) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.status(200).json(resultats.length > 0 ? resultats[0] : null);
        }
    );
});

// Unités de gestion d'un document planificateur
router.get("/pgestion/doc/uuid=:uuid_doc/ug", (req, res) => {
    const queryObject = {
        text: `SELECT uuid_ug, code, nom, surface, document
               FROM docplan.unites_gestion
               WHERE document = $1
               ORDER BY code;`,
        values: [req.params.uuid_doc]
    };
    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "sites/pgestion/doc/ug" },
        "select",
        (resultats, message) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.status(200).json(resultats);
        }
    );
});

// Liste des entités cohérentes de gestion avec leurs sites associés
router.get("/pgestion/entites_coherentes", (req, res) => {
    const queryObject = {
        text: `SELECT uuid_ecg, nom_ecg, nom FROM docplan.listecg ORDER BY nom_ecg;`,
        values: []
    };
    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "sites/pgestion/entites_coherentes" },
        "select",
        (resultats) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.status(200).json(resultats);
        }
    );
});

// Recherche de documents de plans de gestion par critères
router.get("/pgestion/criteria/:annee_deb/:localisation/:typ_document/:actuel", async (req, res) => {
    const { annee_deb, localisation, typ_document, actuel } = req.params;

    let conditions = [];
    let values = [];
    let i = 1;

    if (annee_deb !== '*') {
        conditions.push(`d.annee_deb = $${i++}`);
        values.push(parseInt(annee_deb));
    }
    if (localisation !== '*') {
        conditions.push(`((s.code || ' - ' || e.nom) = $${i} OR ec.nom = $${i++})`);
        values.push(localisation);
    }
    if (typ_document !== '*') {
        conditions.push(`t.libelle = $${i++}`);
        values.push(typ_document);
    }
    if (actuel !== '*') {
        conditions.push(`d.actuel = $${i++}`);
        values.push(actuel);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const queryObject = {
        text: `SELECT
                   d.uuid_doc,
                   d.nom AS document,
                   d.annee_deb,
                   d.annee_fin,
                   d.actuel AS docactuel,
                   t.libelle AS typ_document,
                   d.surface,
                   CASE
                       WHEN d.site IS NOT NULL THEN s.code || ' - ' || e.nom
                       WHEN d.entite_coherente IS NOT NULL THEN ec.nom
                   END AS localisation
               FROM docplan.documents d
               LEFT JOIN sitcenca.sites s ON s.uuid_site = d.site
               LEFT JOIN esp.espaces e ON s.espace = e.uuid_espace
               LEFT JOIN docplan.entites_coherentes ec ON ec.uuid_ecg = d.entite_coherente
               LEFT JOIN docplan.typ_documents t ON t.cd_type = d.typ_document
               ${where}
               ORDER BY d.annee_deb DESC;`,
        values: values
    };

    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "sites/pgestion/criteria" },
        "select",
        (resultats) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.status(200).json(resultats);
        }
    );
});


// DOCPLAN Selectors de la barre de recherche des plans de gestion
router.get("/selectors_pgestion", (req, res) => {
    distinctResearchRaw(
        pool, [], "annee_deb", "Année",
        `SELECT DISTINCT annee_deb FROM docplan.documents WHERE annee_deb IS NOT NULL ORDER BY annee_deb DESC;`,
        (selectors) => {
            distinctResearchRaw(
                pool, selectors, "localisation", "Localisation",
                `SELECT DISTINCT
                    CASE
                        WHEN d.site IS NOT NULL THEN s.code || ' - ' || e.nom
                        WHEN d.entite_coherente IS NOT NULL THEN ec.nom
                    END AS localisation
                 FROM docplan.documents d
                 LEFT JOIN sitcenca.sites s ON s.uuid_site = d.site
                 LEFT JOIN esp.espaces e ON s.espace = e.uuid_espace
                 LEFT JOIN docplan.entites_coherentes ec ON ec.uuid_ecg = d.entite_coherente
                 WHERE d.site IS NOT NULL OR d.entite_coherente IS NOT NULL
                 ORDER BY localisation;`,
                (selectors) => {
                    distinctResearchRaw(
                        pool, selectors, "typ_document", "Type",
                        `SELECT DISTINCT t.libelle AS typ_document
                         FROM docplan.documents d
                         JOIN docplan.typ_documents t ON t.cd_type = d.typ_document
                         ORDER BY typ_document;`,
                        (selectors) => {
                            selectors.push({ name: "actuel", title: "Actuel", values: ["Oui", "Non"] });
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
});


module.exports = router;
