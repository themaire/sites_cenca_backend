const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // autorise toutes les origines
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Répond aux requêtes OPTIONS (préflight)
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

const { handleDelete } = require('../../fonctions/routeHandlers.js');
const { authenticateToken } = require("../../fonctions/fonctionsAuth.js");


// Fonctions et connexion à PostgreSQL
const { ExecuteQuerySite } = require("../../fonctions/fonctionsSites.js");
const pool = require("../../dbPool/poolConnect.js");

// Generateur de requetes SQL
const { generateDeleteQuery } = require("../../fonctions/querys.js");

// Supprimer un acte MFU et tous ses rattachements multi-sites en une transaction.
router.delete('/mfu/actes/uuid_acte=:acteUuid', async (req, res) => {
    const { acteUuid } = req.params;

    if (!acteUuid) {
        return res.status(400).json({
            success: false,
            message: 'Paramètre acteUuid manquant.',
        });
    }

    try {
        await pool.query('BEGIN');

        await pool.query(
            `DELETE FROM sitcenca.actes_mfu_multi
             WHERE ref_uuid_acte = $1`,
            [acteUuid]
        );

        const deleteActeResult = await pool.query(
            `DELETE FROM sitcenca.actes_mfu
             WHERE uuid_acte = $1
             RETURNING uuid_acte`,
            [acteUuid]
        );

        if (!deleteActeResult.rowCount) {
            await pool.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: 'Acte introuvable.',
            });
        }

        await pool.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Acte et rattachements supprimés.',
            code: 0,
            data: deleteActeResult.rows[0],
        });
    } catch (error) {
        try {
            await pool.query('ROLLBACK');
        } catch (rollbackError) {
            console.error('Erreur rollback suppression acte:', rollbackError);
        }

        console.error('Erreur suppression acte MFU:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur lors de la suppression de l\'acte MFU.',
            code: 1,
        });
    }
});

// Détacher un site secondaire d'un acte MFU multi-sites
router.delete('/mfu/actes-multi/ref_uuid_acte=:acteUuid/ref_uuid_site=:siteUuid', async (req, res) => {
    const { acteUuid, siteUuid } = req.params;
    const currentSiteUuid = String(req.query.currentSiteUuid || '').trim();

    const normalizeUuid = (value) => String(value || '').trim().toLowerCase();
    const sameUuid = (left, right) => normalizeUuid(left) === normalizeUuid(right);

    if (!acteUuid || !siteUuid) {
        return res.status(400).json({
            success: false,
            message: 'Paramètres acteUuid/siteUuid manquants.',
        });
    }

    if (currentSiteUuid && sameUuid(currentSiteUuid, siteUuid)) {
        return res.status(400).json({
            success: false,
            message: 'Impossible de détacher le site actuellement ouvert.',
        });
    }

    try {
        await pool.query('BEGIN');

        const acteQuery = `
            SELECT uuid_acte, site
            FROM sitcenca.actes_mfu
            WHERE uuid_acte = $1
            FOR UPDATE;
        `;
        const acteResult = await pool.query(acteQuery, [acteUuid]);

        if (!acteResult.rowCount) {
            await pool.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: 'Acte introuvable.',
            });
        }

        const acteRow = acteResult.rows[0];
        const isPrimarySite = sameUuid(acteRow.site, siteUuid);
        const detached = {
            ref_uuid_acte: acteUuid,
            ref_uuid_site: siteUuid,
        };

        if (isPrimarySite) {
            if (!currentSiteUuid) {
                await pool.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: 'Le site courant est requis pour détacher le site principal de l\'acte.',
                });
            }

            const currentAttachedQuery = `
                SELECT 1
                FROM sitcenca.actes_mfu_multi
                WHERE ref_uuid_acte = $1 AND ref_uuid_site = $2
                LIMIT 1;
            `;
            const currentAttachedResult = await pool.query(currentAttachedQuery, [acteUuid, currentSiteUuid]);

            if (!currentAttachedResult.rowCount) {
                await pool.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: 'Le site ouvert n\'est pas rattaché à cet acte.',
                });
            }

            await pool.query(
                `DELETE FROM sitcenca.actes_mfu_multi
                 WHERE ref_uuid_acte = $1 AND ref_uuid_site = $2`,
                [acteUuid, currentSiteUuid]
            );

            await pool.query(
                `UPDATE sitcenca.actes_mfu
                 SET site = $2
                 WHERE uuid_acte = $1`,
                [acteUuid, currentSiteUuid]
            );

            await pool.query(
                `DELETE FROM sitcenca.actes_mfu_multi
                 WHERE ref_uuid_acte = $1 AND ref_uuid_site = $2`,
                [acteUuid, siteUuid]
            );
        } else {
            const detachQuery = `
                DELETE FROM sitcenca.actes_mfu_multi
                WHERE ref_uuid_acte = $1 AND ref_uuid_site = $2
                RETURNING ref_uuid_acte, ref_uuid_site;
            `;

            const detachResult = await pool.query(detachQuery, [acteUuid, siteUuid]);

            if (!detachResult.rowCount) {
                await pool.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    message: 'Rattachement introuvable.',
                });
            }
        }

        await pool.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: 'Site détaché de l\'acte.',
            data: detached,
        });
    } catch (error) {
        try {
            await pool.query('ROLLBACK');
        } catch (rollbackError) {
            console.error('Erreur rollback détachement acte/site:', rollbackError);
        }
        console.error('Erreur suppression rattachement acte/site:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur lors du détachement du site.',
        });
    }
});

// Supprimer une opération, une localisation (d'opération), un projet, etc.

// Commenté pour le moment, remplacé par handleDelete dans fonctions/routeHandlers.js
// router.delete(
//     "/delete/:table/:uuidName=:id/:idBisName?/:idBis?",
//     (req, res) => {
//         const table = req.params.table.split(".");
//         const uuidName = req.params.uuidName; // Nom de la clé primaire
//         const id = req.params.id;
//         const idBisName = req.params.idBisName; // Nom de la clé supplémentaire (optionnel)
//         const idBis = req.params.idBis; // Valeur de la clé supplémentaire (optionnel)
//         console.log("table pour suppression : " + req.params.table);
//         try {
//             // Avant la gestion d'une eventuelle seconde clé primaire à utiliser pour supprimer un enregistrement
//             // const queryObject = generateDeleteQuery(req.params.table, id, programmeId);

//             // Si idBisName et idBis sont définis, passez-les à generateDeleteQuery
//             const queryObject =
//                 idBisName && idBis
//                     ? generateDeleteQuery(
//                           req.params.table,
//                           uuidName,
//                           id,
//                           idBisName,
//                           idBis
//                       )
//                     : generateDeleteQuery(req.params.table, uuidName, id);

//             ExecuteQuerySite(
//                 pool,
//                 {
//                     query: queryObject,
//                     message:
//                         table[1].charAt(0).toUpperCase() +
//                         table[1].slice(1) +
//                         "/delete",
//                 },
//                 "delete",
//                 (resultats, message) => {
//                     res.setHeader("Access-Control-Allow-Origin", "*");
//                     res.setHeader(
//                         "Content-Type",
//                         "application/json; charset=utf-8"
//                     );

//                     if (message === "ok") {
//                         res.status(200).json({
//                             success: true,
//                             message: "Suppression réussie de l'opération.",
//                             code: 0,
//                             data: resultats,
//                         });
//                         console.log("message : " + message);
//                     } else {
//                         res.status(500).json({
//                             success: false,
//                             message: "Erreur lors de la suppression.",
//                             code: 1,
//                         });
//                         console.log("message : " + message);
//                     }
//                 }
//             );
//         } catch (error) {
//             console.error(
//                 "Erreur lors de la suppression de l'opération:",
//                 error
//             );
//             res.status(500).json({
//                 success: false,
//                 message: "Erreur interne du serveur.",
//             });
//         }
//     }
// );

// Supprimer une entité cohérente de gestion docplan
router.delete("/delete/docplan_entites_coherentes/uuid_ecg=:uuid_ecg", (req, res) => {
    const queryObject = {
        text: `DELETE FROM docplan.entites_coherentes WHERE uuid_ecg = $1;`,
        values: [req.params.uuid_ecg]
    };
    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "sites/delete/docplan_entites_coherentes" },
        "delete",
        (resultats, message) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            if (message === "ok") {
                res.status(200).json({ success: true, message: "Suppression réussie.", code: 0, data: resultats });
            } else {
                res.status(500).json({ success: false, message: "Erreur lors de la suppression.", code: 1 });
            }
        }
    );
});

// Supprimer une unité de gestion docplan
router.delete("/delete/docplan_unites_gestion/uuid_ug=:uuid_ug", (req, res) => {
    const queryObject = {
        text: `DELETE FROM docplan.unites_gestion WHERE uuid_ug = $1;`,
        values: [req.params.uuid_ug]
    };
    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "sites/delete/docplan_unites_gestion" },
        "delete",
        (resultats, message) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            if (message === "ok") {
                res.status(200).json({ success: true, message: "Suppression réussie.", code: 0, data: resultats });
            } else {
                res.status(500).json({ success: false, message: "Erreur lors de la suppression.", code: 1 });
            }
        }
    );
});

// Données rattachées à un site (ou à son espace) qui empêchent sa suppression.
// On ne supprime que les sites "vides" (ex. créés par erreur) : si une de ces tables
// contient des lignes, la route répond 409 avec la liste, sans rien supprimer.
// ref = "site" → comparé à uuid_site, ref = "espace" → comparé à uuid_espace.
// sql (optionnel) → sous-requête de comptage complète quand le lien n'est pas une simple colonne
// ($1 = uuid_site, $2 = uuid_espace).
const SITE_DELETE_BLOCKERS = [
    { table: "opegerer.projets", colonne: "site", ref: "site", libelle: "projets (et leurs opérations)" },
    {
        // Projets "autres" : rattachés à l'espace via la localisation de leurs opérations
        // (opeautres.localisations.cd_localisation = uuid_espace, cf. vue ope.listeprojets)
        table: "opeautres.projets",
        libelle: "projets autres (et leurs opérations)",
        sql: `SELECT count(DISTINCT ope.projet)
                FROM opeautres.localisations loc
                JOIN opeautres.operations ope ON ope.uuid_ope::text = loc.uuid_ope::text
               WHERE loc.cd_localisation::text = $2`,
    },
    { table: "opegerer.historiques", colonne: "site", ref: "site", libelle: "historiques d'opérations" },
    { table: "sitcenca.actes_mfu", colonne: "site", ref: "site", libelle: "actes MFU" },
    { table: "sitcenca.actes_mfu_multi", colonne: "ref_uuid_site", ref: "site", libelle: "rattachements à des actes MFU multi-sites" },
    { table: "sitcenca.conservateurs", colonne: "site", ref: "site", libelle: "conservateurs" },
    { table: "sitcenca.agriculteurs_contrats", colonne: "site", ref: "site", libelle: "contrats agriculteurs" },
    { table: "docplan.documents", colonne: "site", ref: "site", libelle: "documents de planification" },
    { table: "docplan.sites_ecg", colonne: "site", ref: "site", libelle: "entités cohérentes de gestion" },
    { table: "librevo.entites", colonne: "site", ref: "site", libelle: "entités libre évolution" },
    { table: "mescomp.sites_mc", colonne: "site", ref: "site", libelle: "mesures compensatoires" },
    { table: "librevo.localisation", colonne: "espace", ref: "espace", libelle: "localisations libre évolution" },
    { table: "n2000.ao_espaces", colonne: "espace", ref: "espace", libelle: "Natura 2000 : AO espaces" },
    { table: "n2000.contrats", colonne: "espace", ref: "espace", libelle: "Natura 2000 : contrats" },
    { table: "n2000.docob", colonne: "espace", ref: "espace", libelle: "Natura 2000 : DOCOB" },
];

// Compte les données rattachées qui empêchent la suppression du site.
// db = pool ou client de transaction. Renvoie [{ table, libelle, nombre }] (vide si supprimable).
async function getSiteDeleteDependances(db, uuidSite, uuidEspace) {
    const countSql = SITE_DELETE_BLOCKERS.map(
        (b, i) =>
            b.sql
                ? `(${b.sql}) AS c${i}`
                : `(SELECT count(*) FROM ${b.table} WHERE ${b.colonne}::text = $${b.ref === "site" ? 1 : 2}) AS c${i}`
    ).join(", ");
    const counts = (await db.query("SELECT " + countSql, [uuidSite, uuidEspace])).rows[0];
    return SITE_DELETE_BLOCKERS.map((b, i) => ({
        table: b.table,
        libelle: b.libelle,
        nombre: parseInt(counts["c" + i], 10),
    })).filter((d) => d.nombre > 0);
}

// Contenu propre à l'espace, qui partirait en cascade avec lui (informatif, non bloquant).
async function getSiteCascadeContent(db, uuidEspace) {
    const result = await db.query(
        `SELECT
            (SELECT count(*) FROM esp.geometries WHERE espace = $1) AS geometries,
            (SELECT count(*) FROM esp.milieux_naturels WHERE espace = $1) AS milieux_naturels,
            (SELECT count(*) FROM esp.amenagements WHERE espace = $1) AS amenagements,
            (SELECT coalesce(json_agg(json_build_object('insee', loca.commune, 'nom', com.nom) ORDER BY com.nom), '[]'::json)
               FROM esp.localisations loca
               LEFT JOIN terr.listecommunes com ON loca.commune = com.insee_com
              WHERE loca.espace = $1) AS communes`,
        [uuidEspace]
    );
    const row = result.rows[0];
    return {
        geometries: parseInt(row.geometries, 10),
        milieux_naturels: parseInt(row.milieux_naturels, 10),
        amenagements: parseInt(row.amenagements, 10),
        communes: row.communes,
    };
}

// Éclaireur : le site est-il supprimable ? (aucune suppression, lecture seule)
// → { supprimable, site: { uuid_site, uuid_espace, code, nom }, dependances: [...], supprime_avec_le_site: {...} }
router.get("/delete/site/uuid_site=:uuid", authenticateToken, async (req, res) => {
    const uuidSite = req.params.uuid;
    try {
        const siteResult = await pool.query(
            `SELECT site.uuid_site, site.espace, site.code, espa.nom
               FROM sitcenca.sites site
               LEFT JOIN esp.espaces espa ON espa.uuid_espace = site.espace
              WHERE site.uuid_site = $1`,
            [uuidSite]
        );
        if (!siteResult.rowCount) {
            return res.status(404).json({ success: false, message: "Site introuvable.", code: 1 });
        }
        const { espace: uuidEspace, code, nom } = siteResult.rows[0];

        const dependances = await getSiteDeleteDependances(pool, uuidSite, uuidEspace);
        const supprimeAvecLeSite = await getSiteCascadeContent(pool, uuidEspace);

        return res.status(200).json({
            success: true,
            code: 0,
            data: {
                supprimable: dependances.length === 0,
                site: { uuid_site: uuidSite, uuid_espace: uuidEspace, code, nom },
                dependances,
                supprime_avec_le_site: supprimeAvecLeSite,
            },
        });
    } catch (error) {
        console.error("Erreur lors de la vérification de suppression du site " + uuidSite + " :", error);
        return res.status(500).json({ success: false, message: "Erreur lors de la vérification du site.", code: 1 });
    }
});

// Supprimer un site ET son espace (symétrique de la création /put/table=espace_site/insert).
// La suppression de esp.espaces entraîne en cascade : sitcenca.sites, esp.geometries,
// esp.centroides, esp.localisations (communes), esp.milieux_naturels, esp.amenagements.
router.delete("/delete/site/uuid_site=:uuid", authenticateToken, async (req, res) => {
    const uuidSite = req.params.uuid;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // Verrouille la ligne du site le temps de la vérification et de la suppression
        const siteResult = await client.query(
            "SELECT uuid_site, espace, code FROM sitcenca.sites WHERE uuid_site = $1 FOR UPDATE",
            [uuidSite]
        );
        if (!siteResult.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Site introuvable.", code: 1 });
        }
        const { espace: uuidEspace, code } = siteResult.rows[0];

        // Comptage des données rattachées (même vérification que la route éclaireur GET)
        const dependances = await getSiteDeleteDependances(client, uuidSite, uuidEspace);

        if (dependances.length) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                success: false,
                code: 1,
                message:
                    "Suppression impossible : le site " + code + " a des données rattachées (" +
                    dependances.map((d) => d.nombre + " " + d.libelle).join(", ") + ").",
                data: { dependances },
            });
        }

        await client.query("DELETE FROM sitcenca.sites WHERE uuid_site = $1", [uuidSite]);
        if (uuidEspace) {
            // Historique technique des ajouts de géométrie (rempli par le trigger tg_fill_histo_geom) :
            // sa clé étrangère sans cascade bloquerait la suppression des géométries de l'espace.
            await client.query(
                `DELETE FROM esp.histo_add_geometrie
                 WHERE geom_id IN (SELECT geom_id FROM esp.geometries WHERE espace = $1)`,
                [uuidEspace]
            );
            await client.query("DELETE FROM esp.espaces WHERE uuid_espace = $1", [uuidEspace]);
        }

        await client.query("COMMIT");

        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.status(200).json({
            success: true,
            code: 0,
            message: "Site " + code + " supprimé.",
            data: { uuid_site: uuidSite, uuid_espace: uuidEspace },
        });
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error("Erreur rollback suppression site :", rollbackError);
        }
        console.error("Erreur lors de la suppression du site " + uuidSite + " :", error);
        return res.status(500).json({ success: false, message: "Erreur lors de la suppression du site.", code: 1 });
    } finally {
        client.release();
    }
});

// Retirer une commune rattachée à un site (via son espace : esp.localisations)
router.delete("/commune/uuid_site=:uuid_site/insee=:insee", authenticateToken, async (req, res) => {
    const { uuid_site: uuidSite, insee } = req.params;

    if (!/^\d[\dAB]\d{3}$/.test(insee)) {
        return res.status(400).json({ success: false, message: "Code INSEE invalide : " + insee + ".", code: 1 });
    }

    try {
        const result = await pool.query(
            `DELETE FROM esp.localisations l
             USING sitcenca.sites s
             WHERE s.uuid_site = $1 AND l.espace = s.espace AND l.commune = $2
             RETURNING l.commune`,
            [uuidSite, insee]
        );
        if (!result.rowCount) {
            return res.status(404).json({ success: false, message: "La commune " + insee + " n'est pas rattachée à ce site.", code: 1 });
        }
        return res.status(200).json({
            success: true,
            code: 0,
            message: "Commune " + insee + " retirée du site.",
            data: result.rows[0],
        });
    } catch (error) {
        console.error("Erreur lors du retrait de la commune " + insee + " du site " + uuidSite + " :", error);
        return res.status(500).json({ success: false, message: "Erreur lors du retrait de la commune.", code: 1 });
    }
});

// Détacher un conservateur d'un site (le contact et son étiquette CB restent dans l'annuaire)
router.delete("/conservateur/uuid_site=:uuid_site/uuid_ann=:uuid_ann", authenticateToken, async (req, res) => {
    const { uuid_site: uuidSite, uuid_ann: uuidAnn } = req.params;
    try {
        const result = await pool.query(
            "DELETE FROM sitcenca.conservateurs WHERE site = $1 AND societe = $2 RETURNING societe AS uuid_ann",
            [uuidSite, uuidAnn]
        );
        if (!result.rowCount) {
            return res.status(404).json({ success: false, message: "Ce conservateur n'est pas rattaché à ce site.", code: 1 });
        }
        return res.status(200).json({
            success: true,
            code: 0,
            message: "Conservateur détaché du site.",
            data: result.rows[0],
        });
    } catch (error) {
        console.error("Erreur lors du retrait du conservateur " + uuidAnn + " du site " + uuidSite + " :", error);
        return res.status(500).json({ success: false, message: "Erreur lors du retrait du conservateur.", code: 1 });
    }
});

// La route est maintenant gérée par handleDelete dans fonctions/routeHandlers.js
// C'est plus propre et évite la duplication de code
// On délègue la logique de suppression à handleDelete qui est un fichier à part, partagé entre plusieurs routes si besoin
router.delete("/delete/:table/:uuidName=:id/:idBisName?/:idBis?", (req, res) => {
    handleDelete(req, res, pool);
});

// Supprimer un fichier
router.delete("/delete/:table", (req, res) => {
    const table = req.params.table.split(".");
    const doc_path = req.query.doc_path;
    console.log("doc_path : " + doc_path);
    console.log("table pour suppression : " + req.params.table);

    if (!doc_path) {
        return res.status(400).json({
            success: false,
            message: "Paramètre doc_path manquant",
            code: 1,
        });
    }

    try {
        const queryObject = generateDeleteQuery(
                                            req.params.table,
                                            "doc_path",
                                            doc_path
                                        );
        console.log("queryObject avant exécution : " + JSON.stringify(queryObject));
        console.log("queryObject type : " + typeof queryObject);
        ExecuteQuerySite(
            pool,
            {
                query: queryObject,
                message:
                    table[1].charAt(0).toUpperCase() +
                    table[1].slice(1) +
                    "/delete",
            },
            "delete",
            (resultats, message) => {
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader(
                    "Content-Type",
                    "application/json; charset=utf-8"
                );

                // Si la suppression en base de données est un succès, on supprime les fichiers physiquement (fichier plus eventuel fichier de cache)
                if (message === "ok") {
                    // suppression physique avec check path traversal
                    const uploadsDir = path.join('/mnt/storage_data/app');
                    console.log("uploadsDir:", uploadsDir);

                    const cacheDir = path.resolve(uploadsDir, "cache");
                    
                    // doc_path est relatif à uploadsDir (ex: "photos/pmfu/doc_41_...jpg")
                    let filePath = path.resolve(uploadsDir, doc_path);
                    // Rétrocompat : anciens enregistrements BDD sans le préfixe "photos/" (slice(-2) bug)
                    if (!fs.existsSync(filePath) && /\.(jpg|jpeg|png)$/i.test(doc_path)) {
                        const legacyPath = path.resolve(uploadsDir, 'photos', doc_path);
                        if (fs.existsSync(legacyPath)) filePath = legacyPath;
                    }
                    console.log("Fichier à supprimer:", filePath);
                    
                    // Construire le pattern de recherche pour tous les fichiers de cache liés.
                    // Le cache est nommé avec les '/' remplacés par '_' (même logique que pictureRoute.js).
                    // Exemple: "photos/doc_42_plan.jpg" → cherche "photos_doc_42_plan_*.jpg"
                    const safeFileName = doc_path.replace(/\//g, '_');
                    const ext = path.extname(safeFileName);
                    const basename = path.basename(safeFileName, ext);
                    const cachePattern = `${basename}_*${ext}`;
                    console.log("Pattern de cache à rechercher:", cachePattern);
                    
                    // Vérification : le fichier doit être dans le bon dossier
                    if (!filePath.startsWith(uploadsDir)) {
                        console.warn("Tentative de path traversal détectée:", doc_path);
                        return res.status(400).json({
                            success: false,
                            message: "Chemin de fichier invalide",
                            code: 3,
                        });
                    }
                    // Supprimer tous les fichiers de cache correspondant au pattern
                    // console.log("[DELETE] doc_path reçu :", doc_path);
                    // console.log("[DELETE] filePath résolu :", filePath);
                    // console.log("[DELETE] cacheDir :", cacheDir);
                    // console.log("[DELETE] cachePattern :", cachePattern);
                    if (safeFileName.endsWith(".jpg") || safeFileName.endsWith(".jpeg") || safeFileName.endsWith(".png")) {
                        const glob = require('glob');
                        const cacheFiles = glob.sync(path.join(cacheDir, cachePattern));
                        console.log(`[DELETE] Fichiers de cache trouvés (${cacheFiles.length}):`, cacheFiles);
                        
                        cacheFiles.forEach(cacheFile => {
                            fs.unlink(cacheFile, (err) => {
                                if (err) {
                                    console.error("Erreur suppression cache:", err);
                                } else {
                                    console.log("Cache supprimé:", cacheFile);
                                }
                            });
                        });
                    }
                    fs.unlink(filePath, (err) => {
                        if (err) {
                            console.error("Erreur suppression fichier:", err);
                            return res.status(500).json({
                                success: false,
                                message: "Fichier introuvable ou non supprimé",
                                code: 2,
                            });
                        }
                        console.log("Fichier supprimé:", filePath);
                        res.status(200).json({
                            success: true,
                            message: "Suppression réussie du fichier.",
                            code: 0,
                            data: resultats,
                        });
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        message: "Erreur lors de la suppression en base.",
                        code: 1,
                    });
                }
            }
        );
    } catch (error) {
        console.error("Erreur lors de la suppression:", error);
        res.status(500).json({
            success: false,
            message: "Erreur interne du serveur.",
        });
    }
});
module.exports = router;
