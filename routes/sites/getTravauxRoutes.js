// Projets travaux (opegerer, typ_projet = 'TRV') : recherche, projets, opérations, objectifs, fiche travaux Word
// Monté sur /sites dans node_base_sites.js
const express = require("express");
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const { selectListTravauxQuery, ExecuteQuerySite, distinctResearchRaw, executeQueryAndRespond, reset, getBilan } = require("../../fonctions/fonctionsSites.js");
const { generateFicheTravauxWord, nomFichierFicheTravaux } = require("../../scripts/gen_fiche_travaux.js");
const pool = require("../../dbPool/poolConnect.js");

router.get("/criteria_travaux/:annee/:responsable/:code/:statut", (req, res) => {
    // A FAIRE POUR PLUS TARD : adapter la fonction executeQueryAndRespond() (utilisée de partout sur toutes le routes) pour qu'elle puisse prendre en compte les paramètres de la requête

    const queryObject = selectListTravauxQuery(req.params); // Fabrique la requete avec son where en fonction des req.params
    console.log(
        "Requête pour les critères de recherche de projets travaux : " +
        JSON.stringify(queryObject)
    );

    ExecuteQuerySite(
        pool,
        { message: "/sites/criteria_travaux/annee/responsable/code/statut", query: queryObject },
        "select",
        (resultats, message) => {
            if (resultats.length > 0 || message == "ok") {
                const json = JSON.stringify(resultats);
                // console.log(json);
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(json);
            } else {
                const json = JSON.stringify([]);
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(json);
            }
        }
    );
}
);


// Les projets travaux
router.get("/projets/uuid=:uuid/:mode", (req, res) => {
    const mode = req.params.mode; // 'lite' ou 'full'
    const type = req.query.type || null; // Paramètre optionnel "type"
    const webapp = req.query.webapp || null; // Paramètre optionnel "webapp"
    const webappNum = webapp === '1' ? 1 : 0; // Convert string to number safely
    console.log(
        "Demande de projet pour l'uuid " +
        req.params.uuid +
        " et le mode " +
        req.params.mode +
        " avec type " +
        type +
        " et webapp " +
        webapp
    );

    let { selectFields, fromTable, where, message } = reset();
    message =
        "sites/projets/uuid/" +
        req.params.mode +
        ". Params " +
        JSON.stringify(req.query);
    selectFields = "SELECT ";

    where = "where ";
    // Liste liste pour les projets à l'ancienne (application MS Access)
    if (mode == "lite") {
        if (webappNum === 1) {
            // La vue donne le libellé du type de projet dans typ_projet : on renvoie le code (comme /sites/autres)
            // et le libellé dans typ_projet_libelle
            selectFields +=
                "uuid_ope, uuid_proj, responsable, annee, date_deb, projet, action, generation, statut, webapp, uuid_site, ";
            selectFields += "tp.cd_type AS typ_projet, s.typ_projet AS typ_projet_libelle ";
            fromTable = "FROM ope.synthesesites s LEFT JOIN ope.typ_projets tp ON tp.libelle = s.typ_projet ";
            where += "cd_localisation = $1";
            // where += " and generation = '1_TVX'";
            where += " order by annee desc;";
        } else {
            console.log("Erreur : mode 'lite' non géré pour webapp");
            console.log(
                "Type de webapp : " + webapp + "  --  " + typeof webapp
            );
        }
    } else if (mode == "full") {
        if (type == "gestion") {
            selectFields +=
                "uuid_proj, code, itin_tech, validite, document, programme, opegerer.projets.nom, perspectives, annee, opegerer.projets.statut, responsable, concat(sal.prenom, ' ', sal.nom) as responsable_str, typ_projet, createur, date_crea, site, pro_webapp, pro_maitre_ouvrage, loc_poly as geom ";
            fromTable =
                "FROM opegerer.projets LEFT JOIN opegerer.localisations ON opegerer.projets.uuid_proj = opegerer.localisations.ref_uuid_proj ";
            fromTable +=
                "LEFT JOIN admin.salaries sal ON sal.cd_salarie = opegerer.projets.responsable ";
            where += "uuid_proj = $1;";
        } else if (type == "autre") {
            selectFields +=
                "uuid_proj, code, validite, programme, nom, annee, statut, responsable, typ_projet, createur, date_crea, loc_poly as geom ";
            fromTable =
                "FROM opeautres.projets proj LEFT JOIN opegerer.localisations loc ON proj.uuid_proj = loc.ref_uuid_proj ";
            where += "uuid_proj = $1;";
        }
    } else {
        console.log("Erreur : mode 'lite' non géré pour webapp");
        console.log("Type de webapp : " + webapp + "  --  " + typeof webapp);
    }

    executeQueryAndRespond(
        pool,
        selectFields,
        fromTable,
        where,
        req.params.uuid,
        res,
        message,
        req.params.mode
    ); // Retourne un ou plusieurs résultats
});

// Les operations
router.get("/operations/uuid=:uuid/:mode", (req, res) => {
    let { selectFields, fromTable, where, message } = reset();
    const webapp = req.query.webapp || null; // Paramètre optionnel "webapp"
    message = "sites/operation/uuid/" + req.params.mode;

    fromTable = 'FROM opegerer.operations ';
    where = 'where ';
    if (req.params.mode == 'lite') {

        selectFields = `SELECT op.uuid_ope, op.action, op.action_2, concat(ope.get_action_libelle(op.action), ' / ', ope.get_action_libelle(op.action_2)) as type, op.ref_uuid_ann, mo.nom as nom_mo, op.quantite, opegerer.get_libelle(op.unite) as unite_str, op.code, op.titre, op.description, op.remarque, op.surf, to_char(op.date_debut, 'DD/MM/YYYY') as date_debut_str, `;
        selectFields += `(SELECT json_agg(opegerer.get_libelle(checkbox_id) ORDER BY opegerer.get_libelle(checkbox_id)) FROM opegerer.operation_financeurs WHERE uuid_ope = op.uuid_ope ) AS financeurs, financeur_description, `;
        selectFields += `(SELECT json_agg(opegerer.get_libelle(checkbox_id) ORDER BY opegerer.get_libelle(checkbox_id)) FROM opegerer.operation_animaux WHERE uuid_ope = op.uuid_ope ) AS animaux, financeur_description `;
        fromTable += "AS op LEFT JOIN ann.annuaire mo ON mo.uuid_ann = op.ref_uuid_ann ";
        where += "op.ref_uuid_proj = $1 ";
        where += "ORDER BY op.date_debut ASC;";

    } else if (req.params.mode == 'full') {
        selectFields = 'SELECT op.uuid_ope, op.code, op.titre, op.inscrit_pdg, op.rmq_pdg, op.description, op.interv_zh, op.surf, op.lin, op.app_fourr, op.pression_moy, op.ugb_moy, op.nbjours, ';
        selectFields += 'op.charge_moy, op.charge_inst, op.remarque, op.validite, op.action, op.objectif, op.typ_intervention, op.date_debut, op.date_fin, op.date_approx, op.ben_participants, op.ben_heures, ';
        selectFields += 'op.ref_uuid_proj, op.date_ajout, op.ref_loc_id, op.obj_ope, op.action_2, op.ref_uuid_ann, mo.nom as nom_mo, op.cadre_intervention, op.cadre_intervention_detail, op.financeur_description, op.quantite, op.unite, ';
        selectFields += 'op.exportation_fauche, op.total_exporte_fauche, op.productivite_fauche, op.effectif_paturage, op.nb_jours_paturage, op.chargement_paturage, op.abroutissement_paturage, op.recouvrement_ligneux_paturage, op.nom_parc, op.interv_cloture, op.type_intervention_hydro, ';
        selectFields += 'opegerer.get_libelle(op.cadre_intervention) as cadre_intervention_str, opegerer.get_libelle(op.cadre_intervention_detail) as cadre_intervention_detail_str, to_char(op.date_debut, \'DD/MM/YYYY\') as date_debut_str, to_char(op.date_fin, \'DD/MM/YYYY\') as date_fin_str ';
        fromTable += "AS op LEFT JOIN ann.annuaire mo ON mo.uuid_ann = op.ref_uuid_ann ";
        where += 'op.uuid_ope = $1;';
    }

    executeQueryAndRespond(
        pool,
        selectFields,
        fromTable,
        where,
        req.params.uuid,
        res,
        message,
        req.params.mode
    ); // Retourne un ou plusieurs résultats
});

// Les financeurs d'une operation
router.get("/ope-financeurs/uuid=:uuid?", (req, res) => {
    let { selectFields, fromTable, where, message } = reset();
    message = "sites/ope-financeurs/uuid/";

    // Si on n'a pas d'uuid, on récupèrera la liste de tous les types de financeurs possibles
    if (!req.params.uuid) {
        selectFields = "SELECT lib_id, lib_libelle ";
        fromTable = "FROM opegerer.libelles libelles ";
        where = "where libnom_id = 8 order by lib_ordre;";
        executeQueryAndRespond(
            pool,
            selectFields,
            fromTable,
            where,
            null, // ← Changé de "null" à null
            res,
            message,
            "lite" // ← Mode par défaut au lieu de req.params.mode
        ); // Retourne un ou plusieurs résultats
    } else {
        // Sinon, on récupère les financeurs qui ont été saisi d'une opération
        selectFields = "SELECT lib_id, lib_libelle ";
        fromTable =
            "FROM opegerer.libelles libelles JOIN opegerer.operation_financeurs ofi ON libelles.lib_id = ofi.checkbox_id ";
        where = "where uuid_ope = $1;";
        executeQueryAndRespond(
            pool,
            selectFields,
            fromTable,
            where,
            req.params.uuid,
            res,
            message,
            req.params.mode
        ); // Retourne un ou plusieurs résultats
    }
});

// Les animaux d'une operation
router.get("/ope-animaux/uuid=:uuid?", (req, res) => {
    let { selectFields, fromTable, where, message } = reset();
    message = "sites/ope-animaux/uuid/";

    // Si on n'a pas d'uuid, on récupèrera la liste de tous les types d'animaux possibles
    if (!req.params.uuid) {
        selectFields = "SELECT lib_id, lib_libelle ";
        fromTable = "FROM opegerer.libelles libelles ";
        where = "where libnom_id = 10 order by lib_ordre;";
        executeQueryAndRespond(
            pool,
            selectFields,
            fromTable,
            where,
            null, // ← Changé de "null" à null
            res,
            message,
            "lite" // ← Mode par défaut au lieu de req.params.mode
        ); // Retourne un ou plusieurs résultats
    } else {
        // Sinon, on récupère les animaux qui ont été saisi d'une opération
        selectFields = "SELECT lib_id, lib_libelle ";
        fromTable =
            "FROM opegerer.libelles libelles JOIN opegerer.operation_animaux oanimaux ON libelles.lib_id = oanimaux.checkbox_id ";
        where = "where uuid_ope = $1;";
        executeQueryAndRespond(
            pool,
            selectFields,
            fromTable,
            where,
            req.params.uuid,
            res,
            message,
            req.params.mode
        ); // Retourne un ou plusieurs résultats
    }
});

// Les géométries d'operations
router.get("/localisations/uuid=:uuid/:mode", (req, res) => {
    let { selectFields, fromTable, where, message } = reset();
    message = "sites/geometries-operation/uuid_ope/" + req.params.mode;

    fromTable = "FROM opegerer.localisations ";
    where = "where ";
    columnName = "";
    if (req.params.mode == "projet") {
        columnName = "ref_uuid_proj";
    } else if (req.params.mode == "operation") {
        columnName = "ref_uuid_ope";
    }

    selectFields = "SELECT loc_id, loc_date, ";
    selectFields += "CASE ";
    selectFields +=
        "WHEN loc_poly is not null THEN ST_AsGeoJSON( ST_Transform( loc_poly, 4326 ) ) ";
    selectFields +=
        "WHEN loc_point is not null THEN ST_AsGeoJSON( ST_Transform( loc_point, 4326 ) ) ";
    selectFields +=
        "WHEN loc_line is not null THEN ST_AsGeoJSON( ST_Transform( loc_line, 4326 ) ) ";
    selectFields += "END AS geojson, ";
    selectFields += "CASE ";
    selectFields += "WHEN loc_poly is not null THEN st_area(loc_poly) ";
    selectFields += "WHEN loc_point is not null THEN st_area(loc_point) ";
    selectFields += "WHEN loc_line is not null THEN st_area(loc_line) ";
    selectFields += `END as surface, `;
    selectFields += "CASE ";
    selectFields += "WHEN loc_poly is not null THEN 'polygon' ";
    selectFields += "WHEN loc_point is not null THEN 'point' ";
    selectFields += "WHEN loc_line is not null THEN 'ligne' ";
    selectFields += `END as type, `;
    selectFields += `${columnName} `;
    where += `${columnName} = $1;`;

    executeQueryAndRespond(
        pool,
        selectFields,
        fromTable,
        where,
        req.params.uuid,
        res,
        message,
        req.params.mode
    ); // Retourne un ou plusieurs résultats
});

// GeoJSON des géométries des opérations associées à un projet
router.get("/projets/uuid=:uuid/operations/geojson", async (req, res) => {
    const sql = `
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(json_agg(
                json_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(ST_Transform(COALESCE(loc.loc_poly, loc.loc_point, loc.loc_line), 4326))::json,
                    'properties', json_build_object(
                        'uuid_ope', op.uuid_ope,
                        'loc_id', loc.loc_id,
                        'code', op.code,
                        'titre', op.titre,
                        'action', op.action,
                        'action_2', op.action_2,
                        'action_2_libelle', act2.libelle,
                        'type', concat(ope.get_action_libelle(op.action), ' / ', ope.get_action_libelle(op.action_2)),
                        'date_debut', to_char(op.date_debut, 'DD/MM/YYYY'),
                        'surf', op.surf,
                        -- Un point par partie (multipolygone = fauche ici et là-bas), garanti sur la partie
                        -- (le centroïde d'un polygone concave peut tomber dehors) : badges de la carte de la fiche travaux
                        'points_etiquette', (
                            SELECT ST_AsGeoJSON(ST_Transform(ST_Collect(ST_PointOnSurface(part.geom)), 4326))::json
                            FROM ST_Dump(COALESCE(loc.loc_poly, loc.loc_point, loc.loc_line)) part
                        )
                    )
                )
            ) FILTER (WHERE loc.loc_poly IS NOT NULL OR loc.loc_point IS NOT NULL OR loc.loc_line IS NOT NULL), '[]')
        ) AS geojson
        FROM opegerer.operations op
        LEFT JOIN opegerer.localisations loc ON loc.ref_uuid_ope = op.uuid_ope
        LEFT JOIN ope.actions act2 ON act2.cd_action = op.action_2
        WHERE op.ref_uuid_proj = $1;
    `;
    try {
        const result = await pool.query(sql, [req.params.uuid]);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.status(200).json(result.rows[0]?.geojson || { type: "FeatureCollection", features: [] });
    } catch (err) {
        console.error("Erreur SQL /sites/projets/uuid/operations/geojson:", err);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la récupération des géométries des opérations du projet.",
            detail: err.message,
        });
    }
});

// Les objectifs
router.get("/objectifs/uuid=:uuid/:mode", (req, res) => {
    let { selectFields, fromTable, where, message } = reset();
    message = "sites/objectifs/uuid/" + req.params.mode;

    fromTable = "FROM opegerer.objectifs ";
    where = "where ";
    if (req.params.mode == "lite") {
        selectFields =
            "SELECT uuid_objectif, typ_objectif, enjeux_eco, nv_enjeux, obj_ope, objectifop.libelle AS obj_ope_str, enjeux.libelle AS nv_enjeux_str, attentes, surf_totale, unite_gestion, validite, projet, surf_prevue, pression_maitrise ";
        fromTable +=
            " LEFT JOIN opegerer.typ_objectifope objectifop ON obj_ope = objectifop.cd_type ";
        fromTable +=
            " LEFT JOIN opegerer.typ_enjeux enjeux ON nv_enjeux = enjeux.cd_type ";
        where += "projet = $1;";
    } else if (req.params.mode == "full") {
        selectFields =
            "SELECT uuid_objectif, typ_objectif, enjeux_eco, nv_enjeux, obj_ope, attentes, surf_totale, unite_gestion, validite, projet, surf_prevue, pression_maitrise ";
        where += "uuid_objectif = $1;";
    }

    executeQueryAndRespond(
        pool,
        selectFields,
        fromTable,
        where,
        req.params.uuid,
        res,
        message,
        req.params.mode
    ); // Retourne un ou plusieurs résultats
});


// PROJECT Selectors de la barre de recherche de projets travaux (type_projet = 'TRV')
router.get("/selectors_projets", (req, res) => {
    const TRV = "typ_projet = 'TRV'";

    // ATTENTION : on ajoute aussi la condition "pro_webapp = True" pour ne récupérer que les projets qui sont dans la webapp (et pas ceux qui sont à l'ancienne dans MS Access)
    const PRO_WEBAPP = "pro_webapp = True";
    distinctResearchRaw(
        pool, [], "annee", "Année",
        `SELECT DISTINCT annee FROM ope.listeprojets WHERE ${TRV} and ${PRO_WEBAPP} ORDER BY annee DESC;`,
        (selectors) => {
            distinctResearchRaw(
                pool, selectors, "responsable", "Responsable",
                `SELECT DISTINCT responsable FROM ope.listeprojets WHERE ${TRV} and ${PRO_WEBAPP} ORDER BY responsable;`,
                (selectors) => {
                    distinctResearchRaw(
                        pool, selectors, "localisation", "Localisation",
                        `SELECT DISTINCT s.code || ' - ' || e.nom AS localisation FROM ope.listeprojets p JOIN opegerer.projets pr ON pr.uuid_proj = p.uuid_proj JOIN sitcenca.sites s ON s.uuid_site = site JOIN esp.espaces e ON s.espace = e.uuid_espace WHERE p.${TRV} and p.${PRO_WEBAPP} ORDER BY localisation;`,
                        (selectors) => {
                            // console.log("Sélecteurs avant ajout du statut : " + JSON.stringify(selectors));
                            
                            selectors.push({ name: "statut", title: "Statut", values: ["Annulé", "En cours", "Terminé"] });
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


//Fiche travaux
router.get("/bilan_exe/uuid_proj=:uuid", async (req, res) => {
    try {
        const uuid = req.params.uuid;
        const bilan = await getBilan(uuid);
        res.status(200).json(bilan);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const http = require("http");

// Route bilan_exe qui combine les infos du projet travaux
router.get("/gen_fiche_travaux/uuid_proj=:uuid", async (req, res) => {
    console.log("Demande de la fiche travaux pour l'UUID : " + req.params.uuid);
    try {
        const uuid = req.params.uuid;
        const bilan = await getBilan(uuid);
        console.log("Bilan récupéré pour l'UUID : " + uuid);
        if (!bilan) {
            return res
                .status(404)
                .json({ error: "Bilan not found for the given UUID." });
        }
        const buffer = await generateFicheTravauxWord(bilan);

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        // ex. 2026_fiche_travaux_Milieu-Entretenir_10072.docx (voir nomFichierFicheTravaux)
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${nomFichierFicheTravaux(bilan)}"`
        );
        // Rendre Content-Disposition lisible par le front (requête cross-origin)
        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
        res.send(buffer);
    } catch (error) {
        console.error("Erreur lors de la génération du Word :", error); // Log complet côté serveur
        res.status(500).json({
            error: error.message,
            stack: error.stack,
            details: error, // Pour avoir tout l'objet erreur si besoin
        });
    }
});


module.exports = router;
