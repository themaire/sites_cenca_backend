const express = require('express');
const router = express.Router();

// const { authenticateToken } = require('../fonctions/fonctionsAuth.js'); 

// Fonctions et connexion à PostgreSQL
const { joinQuery, selectQuery, ExecuteQuerySite, distinctSiteResearch, executeQueryAndRespond, reset, getBilan } = require('../fonctions/fonctionsSites.js');
const { generateFicheTravauxWord } = require('../scripts/gen_fiche_travaux.js');
const pool = require('../dbPool/poolConnect.js');


// FONCTIONNE !
    // const paramTest = { query : 'SELECT * from esp.geometries limit 2;', message: 'Simple query test'};
    // selectSite(pool, paramTest, (message, res) => {
    //   console.log(res);
    // });

router.get("/criteria/:type/:code/:nom/:commune/:milnat/:resp", 
            (req, res) => {

                // A FAIRE POUR PLUS TARD : adapter la fonction executeQueryAndRespond() (utilisée de partout sur toutes le routes) pour qu'elle puisse prendre en compte les paramètres de la requête

                const queryObject = selectQuery(req.params); // Fabrique la requete avec son where en fonction des req.prams
                console.log("Requête pour les critères de recherche de sites : " + JSON.stringify(queryObject));

                ExecuteQuerySite(
                    pool,
                    { message: "/sites/criteria/type/code...", query: queryObject },
                    "select",
                    ( resultats, message ) => {
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

// Données d'un site par son uuid
router.get("/uuid=:uuid", (req, res) => {
    let { SelectFields, FromTable, where, message, json } = reset();
    message =  "sites/uuid";

    SelectFields = "SELECT ";
    SelectFields +=
        "site.uuid_site, site.code, site.prem_ctr, site.ref_fcen, site.pourc_gere, site.surf_actes, site.url_cen, site.validite::boolean, site.espace, site.typ_site, ";
    SelectFields +=
        "site.responsable, site.date_crea as date_crea_site, site.id_mnhn, site.modif_admin, site.actuel, site.url_mnhn, site.parties_gerees, site.typ_ouverture, site.description_site, ";
    SelectFields +=
        "site.sensibilite, site.remq_sensibilite, site.ref_public::boolean,";
    SelectFields +=
        "espa.uuid_espace, espa.date_crea as date_crea_espace, espa.id_espace, espa.nom, espa.surface, espa.carto_hab, espa.zh, espa.typ_espace, espa.bassin_agence, espa.rgpt, espa.typ_geologie, ";
    SelectFields +=
        "espa.id_source, espa.id_crea, espa.url, espa.maj_admin, ST_AsGeoJSON( ST_Transform( geo.geom, 4326 ) ) geojson, geo.date_crea as date_crea_geom, 'POLYGONE' as type_geom, ST_AREA(geo.geom) as surface_geom ";

    FromTable = "FROM esp.espaces as espa ";
    FromTable +=
        "LEFT JOIN esp.typ_espaces as typesp ON espa.typ_espace = typesp.cd_type ";
    FromTable +=
        "LEFT JOIN sitcenca.sites as site ON espa.uuid_espace = site.espace ";
    FromTable +=
        "LEFT JOIN sitcenca.typ_sites as tsite ON site.typ_site = tsite.cd_type ";
    FromTable +=
        "LEFT JOIN esp.geometries as geo ON geo.espace = espa.uuid_espace ";
    FromTable +=
        "LEFT JOIN esp.typ_geomnatures geona ON geo.typ_nature = geona.cd_type ";
    where = "where uuid_site = $1";

    executeQueryAndRespond(pool, SelectFields, FromTable, where, req.params.uuid, res, message, mode = "full"); // Full car on veut un seul résultat

});

// Communes
router.get("/commune/uuid=:uuid", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();
    message = "sites/commune/uuid";

    SelectFields = "SELECT ";
    // SelectFields += 'commune as insee, com.nom_officiel '
    SelectFields += "commune as insee, com.nom, ";
    SelectFields += "CASE WHEN LEFT(commune,2) = '08' THEN 'Ardennes' ";
    SelectFields += "WHEN LEFT(commune,2) = '10' THEN 'Aube' ";
    SelectFields += "WHEN LEFT(commune,2) = '51' THEN 'Marne' ";
    SelectFields += "WHEN LEFT(commune,2) = '52' THEN 'Haute-Marne' END AS departement ";
    FromTable = "FROM esp.localisations loca ";
    FromTable +=
        "left join esp.espaces espa on loca.espace = espa.uuid_espace ";
    FromTable +=
        "left join sitcenca.sites site on espa.uuid_espace = site.espace ";
    //FromTable += 'left join bd_topo.commune com on loca.commune = com.code_insee ';
    FromTable +=
        "left join terr.listecommunes com on loca.commune = com.insee_com ";
    where = "where site.uuid_site = $1 order by com.nom";

    executeQueryAndRespond(pool, SelectFields, FromTable, where, req.params.uuid, res, message, mode = "lite"); // Retourne plusieurs résultats
});

// Plans de gestion
router.get("/pgestion/uuid=:uuid", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();
    message = "sites/pgestion/uuid";
    
    SelectFields = "SELECT ";
    SelectFields +=
        "uuid_doc, document, annee_deb, annee_fin, docactuel, url, surface ";
    FromTable = "FROM docplan.docplanifsites ";
    where = "where uuid_site = $1 order by docactuel";

    executeQueryAndRespond(pool, SelectFields, FromTable, where, req.params.uuid, res, message, mode = "lite"); // Retourne plusieurs résultats
});

// Milieux naturels
router.get("/milnat/uuid=:uuid", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();
    message = "sites/milnat/uuid";
    
    SelectFields =
        'SELECT typmilnat.libelle as "type_milieu", milnat.pourcentage ';
    FromTable = "FROM esp.espaces espa ";
    FromTable +=
        "left join sitcenca.sites site on espa.uuid_espace = site.espace ";
    FromTable +=
        "left join esp.milieux_naturels milnat on espa.uuid_espace = milnat.espace ";
    FromTable +=
        "left join esp.typ_milieuxnat typmilnat on milnat.typ_milieu = typmilnat.cd_type ";
    where = "where site.uuid_site = $1 order by pourcentage desc";

    executeQueryAndRespond(pool, SelectFields, FromTable, where, req.params.uuid, res, message, mode = "lite"); // Retourne plusieurs résultats
});

// MFU
router.get("/mfu/uuid=:uuid/:mode", (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();
    message = "sites/mfu/uuid/" + req.params.mode;
    mode = req.params.mode;

    if (req.params.mode == "lite") {
        SelectFields = "SELECT site, uuid_acte, debut, fin, tacit_rec, typ_mfu, actuel, url, types_prop, surface ";
        FromTable = "FROM sitcenca.listeactes ";
        where = "where site = $1 order by debut;";
    } else if (req.params.mode == "full") {
        SelectFields = "select amfu.uuid_acte, amfu.debut, amfu.fin, amfu.tacit_rec, amfu.detail_rec, amfu.notaire, amfu.cout, amfu.remarque, amfu.validite, amfu.date_crea, amfu.date_modif, amfu.typ_mfu, amfu.site, amfu.url, amfu.actuel, e.nom as nom_site ";
        FromTable = "FROM sitcenca.actes_mfu AS amfu ";
        FromTable += "LEFT JOIN sitcenca.sites s ON amfu.site = s.uuid_site ";
        FromTable += "LEFT JOIN esp.espaces e ON s.espace = e.uuid_espace ";
        where = "where amfu.uuid_acte = $1;";
    }

    executeQueryAndRespond(pool, SelectFields, FromTable, where, req.params.uuid, res, message, mode); // Retourne un ou plusieurs résultats
});

// Les projets
router.get('/projets/uuid=:uuid/:mode', (req, res) => {
    const mode = req.params.mode; // 'lite' ou 'full'
    const type = req.query.type || null; // Paramètre optionnel "type"
    const webapp = req.query.webapp || null; // Paramètre optionnel "webapp"
    console.log("Demande de projet pour l'uuid " + req.params.uuid + " et le mode " + req.params.mode + " avec type " + type + " et webapp " + webapp);

    let { selectFields, fromTable, where, message } = reset();
    message = "sites/projets/uuid/" + req.params.mode + ". Params " + JSON.stringify(req.query);
    selectFields = 'SELECT ';

    where = 'where ';
    // Liste liste pour les projets à l'ancienne (application MS Access)
    if (mode == 'lite') {
        if (webapp != 1) {
            selectFields += 'uuid_ope, uuid_proj, responsable, annee, date_deb, projet, action, generation, statut, webapp, uuid_site ';
            fromTable = 'FROM ope.synthesesites ';
            where += 'cd_localisation = $1';
            // where += " and generation = '1_TVX'";
            where += " order by annee desc;";
        } else {
            console.log("Erreur : mode 'lite' non géré pour webapp");
            console.log("Type de webapp : " + webapp + "  --  " + typeof(webapp));
        }
    } else if (mode == 'full') {
        if (type == 'gestion') {
            selectFields += "uuid_proj, code, itin_tech, validite, document, programme, opegerer.projets.nom, perspectives, annee, opegerer.projets.statut, responsable, concat(sal.prenom, ' ', sal.nom) as responsable_str, typ_projet, createur, date_crea, site, pro_webapp, pro_maitre_ouvrage, loc_poly as geom ";
            fromTable = "FROM opegerer.projets LEFT JOIN opegerer.localisations ON opegerer.projets.uuid_proj = opegerer.localisations.ref_uuid_proj ";
            fromTable += "LEFT JOIN admin.salaries sal ON sal.cd_salarie = opegerer.projets.responsable ";
            where += "uuid_proj = $1;";
        } else if (type == 'autre') {
            selectFields += 'uuid_proj, code, validite, programme, nom, annee, statut, responsable, typ_projet, createur, date_crea, loc_poly as geom ';
            fromTable = 'FROM opeautres.projets proj LEFT JOIN opegerer.localisations loc ON proj.uuid_proj = loc.ref_uuid_proj ';
            where += 'uuid_proj = $1;';
        }
    } else {
            console.log("Erreur : mode 'lite' non géré pour webapp");
            console.log("Type de webapp : " + webapp + "  --  " + typeof(webapp));
    }

    executeQueryAndRespond(pool, selectFields, fromTable, where, req.params.uuid, res, message, req.params.mode); // Retourne un ou plusieurs résultats
});

// Les operations
router.get('/operations/uuid=:uuid/:mode', (req, res) => {
    let { selectFields, fromTable, where, message } = reset();
    const webapp = req.query.webapp || null; // Paramètre optionnel "webapp"
    message = "sites/operation/uuid/" + req.params.mode;

    fromTable = 'FROM opegerer.operations ';
    where = 'where ';
    if (req.params.mode == 'lite') {

        selectFields = `SELECT op.uuid_ope, concat(ope.get_action_libelle(op.action), ' / ', ope.get_action_libelle(op.action_2)) as type, op.nom_mo, op.quantite, opegerer.get_libelle(op.unite) as unite_str, op.code, op.titre, op.description, op.remarque, op.surf, to_char(op.date_debut, 'DD/MM/YYYY') as date_debut_str, `;
        selectFields += `(SELECT json_agg(opegerer.get_libelle(checkbox_id) ORDER BY opegerer.get_libelle(checkbox_id)) FROM opegerer.operation_financeurs WHERE uuid_ope = op.uuid_ope ) AS financeurs, `;
        selectFields += `(SELECT json_agg(opegerer.get_libelle(checkbox_id) ORDER BY opegerer.get_libelle(checkbox_id)) FROM opegerer.operation_animaux WHERE uuid_ope = op.uuid_ope ) AS animaux `;
        fromTable += 'AS op ';
        where += 'op.ref_uuid_proj = $1 ';
        where += "ORDER BY op.date_ajout DESC;";

    } else if (req.params.mode == 'full') {
        selectFields = 'SELECT uuid_ope, code, titre, inscrit_pdg, rmq_pdg, description, interv_zh, surf, lin, app_fourr, pression_moy, ugb_moy, nbjours, ';
        selectFields += 'charge_moy, charge_inst, remarque, validite, action, objectif, typ_intervention, date_debut, date_fin, date_approx, ben_participants, ben_heures, ';
        selectFields += 'ref_uuid_proj, date_ajout, ref_loc_id, obj_ope, action_2, nom_mo, cadre_intervention, cadre_intervention_detail, financeur_description, quantite, unite, ';
        selectFields += 'exportation_fauche, total_exporte_fauche, productivite_fauche, effectif_paturage, nb_jours_paturage, chargement_paturage, abroutissement_paturage, recouvrement_ligneux_paturage, nom_parc, interv_cloture, type_intervention_hydro, ';
        selectFields += 'opegerer.get_libelle(cadre_intervention) as cadre_intervention_str, opegerer.get_libelle(cadre_intervention_detail) as cadre_intervention_detail_str, to_char(date_debut, \'DD/MM/YYYY\') as date_debut_str, to_char(date_fin, \'DD/MM/YYYY\') as date_fin_str ';
        where += 'uuid_ope = $1;';
    }

    executeQueryAndRespond(pool, selectFields, fromTable, where, req.params.uuid, res, message, req.params.mode); // Retourne un ou plusieurs résultats
});

// Les financeurs d'une operation
router.get('/ope-financeurs/uuid=:uuid?', (req, res) => {
    let { selectFields, fromTable, where, message } = reset();
    message = "sites/ope-financeurs/uuid/";

    // Si on n'a pas d'uuid, on récupèrera la liste de tous les types de financeurs possibles
    if (!req.params.uuid) {
        selectFields = 'SELECT lib_id, lib_libelle ';
        fromTable = 'FROM opegerer.libelles libelles ';
        where = 'where libnom_id = 8 order by lib_ordre;';
        executeQueryAndRespond(pool, selectFields, fromTable, where, "null", res, message, req.params.mode); // Retourne un ou plusieurs résultats

    }else{
        // Sinon, on récupère les financeurs qui ont été saisi d'une opération
        selectFields = 'SELECT lib_id, lib_libelle ';
        fromTable = 'FROM opegerer.libelles libelles JOIN opegerer.operation_financeurs ofi ON libelles.lib_id = ofi.checkbox_id ';
        where = 'where uuid_ope = $1;';
        executeQueryAndRespond(pool, selectFields, fromTable, where, req.params.uuid, res, message, req.params.mode); // Retourne un ou plusieurs résultats
    }
});

// Les animaux d'une operation
router.get('/ope-animaux/uuid=:uuid?', (req, res) => {
    let { selectFields, fromTable, where, message } = reset();
    message = "sites/ope-animaux/uuid/";

    // Si on n'a pas d'uuid, on récupèrera la liste de tous les types d'animaux possibles
    if (!req.params.uuid) {
        selectFields = 'SELECT lib_id, lib_libelle ';
        fromTable = 'FROM opegerer.libelles libelles ';
        where = 'where libnom_id = 10 order by lib_ordre;';
        executeQueryAndRespond(pool, selectFields, fromTable, where, "null", res, message, req.params.mode); // Retourne un ou plusieurs résultats

    }else{
        // Sinon, on récupère les animaux qui ont été saisi d'une opération
        selectFields = 'SELECT lib_id, lib_libelle ';
        fromTable = 'FROM opegerer.libelles libelles JOIN opegerer.operation_animaux oanimaux ON libelles.lib_id = oanimaux.checkbox_id ';
        where = 'where uuid_ope = $1;';
        executeQueryAndRespond(pool, selectFields, fromTable, where, req.params.uuid, res, message, req.params.mode); // Retourne un ou plusieurs résultats
    }
});

// Les géométries d'operations
router.get('/localisations/uuid=:uuid/:mode', (req, res) => {
    let { selectFields, fromTable, where, message } = reset();
    message = "sites/geometries-operation/uuid_ope/" + req.params.mode;

    fromTable = 'FROM opegerer.localisations ';
    where = 'where ';
    columnName = '';
    if (req.params.mode == 'projet') {
        columnName = 'ref_uuid_proj';
    } else if (req.params.mode == 'operation') {
        columnName = 'ref_uuid_ope';
    }

    selectFields = 'SELECT loc_id, loc_date, ';
    selectFields += 'CASE ';
    selectFields += 'WHEN loc_poly is not null THEN ST_AsGeoJSON( ST_Transform( loc_poly, 4326 ) ) ';
    selectFields += 'WHEN loc_point is not null THEN ST_AsGeoJSON( ST_Transform( loc_point, 4326 ) ) ';
    selectFields += 'WHEN loc_line is not null THEN ST_AsGeoJSON( ST_Transform( loc_line, 4326 ) ) ';
    selectFields += 'END AS geojson, ';
    selectFields += 'CASE ';
    selectFields += 'WHEN loc_poly is not null THEN st_area(loc_poly) ';
    selectFields += 'WHEN loc_point is not null THEN st_area(loc_point) ';
    selectFields += 'WHEN loc_line is not null THEN st_area(loc_line) ';
    selectFields += `END as surface, `;
    selectFields += 'CASE ';
    selectFields += 'WHEN loc_poly is not null THEN \'polygon\' ';
    selectFields += 'WHEN loc_point is not null THEN \'point\' ';
    selectFields += 'WHEN loc_line is not null THEN \'ligne\' ';
    selectFields += `END as type, `;
    selectFields += `${columnName} `;
    where += `${columnName} = $1;`;

    executeQueryAndRespond(pool, selectFields, fromTable, where, req.params.uuid, res, message, req.params.mode); // Retourne un ou plusieurs résultats
});

// Les objectifs
router.get('/objectifs/uuid=:uuid/:mode', (req, res) => {
    let { selectFields, fromTable, where, message } = reset();
    message = "sites/objectifs/uuid/" + req.params.mode;
    
    fromTable = 'FROM opegerer.objectifs ';
    where = 'where ';
    if (req.params.mode == 'lite') {
        selectFields = 'SELECT uuid_objectif, typ_objectif, enjeux_eco, nv_enjeux, obj_ope, objectifop.libelle AS obj_ope_str, enjeux.libelle AS nv_enjeux_str, attentes, surf_totale, unite_gestion, validite, projet, surf_prevue, pression_maitrise ';
        fromTable += ' LEFT JOIN opegerer.typ_objectifope objectifop ON obj_ope = objectifop.cd_type ';
        fromTable += ' LEFT JOIN opegerer.typ_enjeux enjeux ON nv_enjeux = enjeux.cd_type ';
        where += 'projet = $1;';
    } else if (req.params.mode == 'full') {
        selectFields = 'SELECT uuid_objectif, typ_objectif, enjeux_eco, nv_enjeux, obj_ope, attentes, surf_totale, unite_gestion, validite, projet, surf_prevue, pression_maitrise ';
        where += 'uuid_objectif = $1;';
    }

    executeQueryAndRespond(pool, selectFields, fromTable, where, req.params.uuid, res, message, req.params.mode); // Retourne un ou plusieurs résultats
});

// Récuperation de l'IP publique
router.get("/getip", async (req, res) => {
    try {
        const response = await axios.get("https://api.ipify.org?format=json");
        const ipData = response.data;

        console.log("Votre IP : " + ipData.ip); // Récupère l'IP publique du client

        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.json(ipData); // Envoie la réponse en JSON
    } catch (error) {
        console.error(
        "Erreur lors de la récupération de l'IP publique :",
        error
        );
        res.status(500).send("Erreur lors de la récupération de l'IP publique");
    }
    });

// Selectors de la barre de recherche de sites par critères
router.get("/selectors", (req, res) => {
    distinctSiteResearch(
        pool,
        [],
        "milieux_naturels",
        "Milieux naturels",
        (selectors) => {
        distinctSiteResearch(
            pool,
            selectors,
            "responsable",
            "Responsable",
            (selectors) => {
            distinctSiteResearch(
                pool,
                selectors,
                "bassin_agence",
                "Bassin agence",
                (selectors) => {
                distinctSiteResearch(
                    pool,
                    selectors,
                    "prem_ctr",
                    "Premier contrat",
                    (selectors) => {
                    distinctSiteResearch(
                        pool,
                        selectors,
                        "fin",
                        "Fin acte",
                        (selectors) => {
                        const json = JSON.stringify(selectors);
                        res.setHeader("Access-Control-Allow-Origin", "*");
                        res.setHeader(
                            "Content-type",
                            "application/json; charset=UTF-8"
                        );
                        res.end(json);
                        }
                    );
                    }
                );
                }
            );
            }
        );
        }
    );
});

// Les liste de choix pour les champs de formulaires
router.get('/selectvalues=:list/:option?', (req, res) => {
    let { SelectFields, FromTable, where, message, json } = reset();
    const list = req.params.list;
    const option = req.params.option;
    message = "/sites/selectvalues/" + list + "/" + option;
    let order = undefined;

    console.log("Demande de la liste de choix de la table " + list);

    SelectFields = 'SELECT ';

    const simpleTables = ['ope.typ_actions', 'ope.typ_financeurs', 'ope.typ_projets', 'ope.typ_roles', 'opegerer.typ_enjeux', 'opegerer.typ_hydrauliques', 'opegerer.typ_infrastructures', 'opegerer.typ_mecaniques', 'opegerer.typ_objectifope', 'opegerer.typ_objectifs'];
    
    // Liste des libelles de la table commune des libelles
    const libelles_names = ['cadre_intervention', 'chantier_nature', 'unites', 'pression_maitrise'];

    if (simpleTables.includes(list)) {
        SelectFields += 'cd_type, libelle ';
    }else if (list == 'ope.actions') {
        SelectFields += 'cd_action as cd_type, libelle, commentaire ';
    }else if (list == 'ope.financeurs') {
        SelectFields += 'cd_prog as cd_type, nom, annee, statut ';
    }else if (list == 'ope.typ_interventions') {
        SelectFields += 'cd_type, lib_type as libelle ';
    }else if (list == 'opegerer.typ_amenagements') {
        SelectFields += 'cd_type as cd_type, libelle, categorie, libelle_pluriel ';
    }else if (list == 'typ_travauxsol') {
        SelectFields += 'cd_type, libelle, val_tri, val_filtre, libelle_pluriel ';
    }else if (list == 'opegerer.typ_troupeaux') {
        SelectFields += 'cd_type, libelle, coef_ugb, right(cd_supra,3) as code_supp, niveau ';
    }else if (list == 'ope.listprogrammes') {
        SelectFields += "cd_programme as cd_type, cd_programme || ' - ' || libelle as libelle ";
    }else if (list == 'opegerer.libelles') {
        SelectFields += 'lib_id as cd_type, lib_libelle as libelle ';
    }
    FromTable = 'FROM ' + list + ' ';
    
    if (order !== undefined) {
        where = 'order by ' + order;
    }else {
        // Filtrer sur des nouvelles valeurs précises
        if (list == 'opegerer.typ_objectifope') {
            where = "where cd_type in ('CRE', 'ENT', 'RES', 'REA', 'MENT', 'MRES', 'MCRE', 'IGEN', 'IGCR', 'IAEN', 'IACR') order by val_filtre;";
        } else if (list == 'ope.actions' && option == 1) { // Les actions comme Pâturage et opérations associées, Gestion hydraulique...
            where = "where cd_action like '%V2' and cd_action != '029_TRAV_SOL_V2' and cd_sup = '004_TRAV' ORDER BY val_tri ASC ;";
        } else if (list == 'ope.actions' && option == 'meca') {
            where = "where cd_sup = '027_TRAV_MECA_V2' order by val_tri;";
        } else if (list == 'ope.actions' && option == 'pat') {
            where = "where cd_sup = '028_TRAV_PAT_V2' order by val_tri;";
        } else if (list == 'ope.actions' && option == 'ame') {
            where = "where cd_sup = '008_TRAV_AMEN_V2' order by val_tri;";
        } else if (list == 'ope.actions' && option == 'hydro') {
            where = "where cd_sup = '005_TRAV_HYDRO_V2' order by val_tri;";
        } else if (list == 'ope.actions' && option == 'dech') {
            where = "where cd_sup = '200_TRAV_DECH_V2' order by val_tri;";
        } else if (list == 'ope.typ_interventions') {
            where = "where val_filtre in (1, 2) order by lib_type;";
        } else if (list == 'ope.listprogrammes') {
            where = "where left(cd_programme,2) in ('24', '25') order by cd_programme;";
        } else if (list == 'opegerer.libelles' && libelles_names.includes(option)) {
            // Si l'option est dans la liste des libelles_names
            // sera dynamique en fonction de l'option choisi c'est a dire la famille de libelles.
            where = "where libnom_id = (SELECT libnom_id FROM opegerer.libelles_nom where libnom_nom = '" + option + "') order by lib_ordre;";
        } else where = 'order by val_tri;';
    }

    if (libelles_names.includes(option)) {
        console.log("---------------Demande de la liste de choix de la table " + list + " pour l'option " + option);
        // Si l'option est dans la liste des libelles_names
    }else {
        console.log("option " + option + " n'est pas dans la liste des libelles_names");
    }

    const queryObject = {
        text: joinQuery(SelectFields, FromTable, where)
    };

    ExecuteQuerySite(
        pool,
        { message: message, query: queryObject },
        "select",
        ( resultats, message ) => {
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
});

router.get('/bilan_exe/uuid_proj=:uuid', async (req, res) => {
    try {
        const uuid = req.params.uuid;
        const bilan = await getBilan(uuid);
        res.status(200).json(bilan);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const http = require('http');

// Route bilan_exe qui combine les infos du projet travaux
router.get('/gen_fiche_travaux/uuid_proj=:uuid', async (req, res) => {
    console.log("Demande de la fiche travaux pour l'UUID : " + req.params.uuid);
    try {
        const uuid = req.params.uuid;
        const bilan = await getBilan(uuid);
        console.log("Bilan récupéré pour l'UUID : " + uuid);
        if (!bilan) {
            return res.status(404).json({ error: 'Bilan not found for the given UUID.' });
        }
        const buffer = await generateFicheTravauxWord(bilan);

        const sanitize = (str) =>
        String(str)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "") // enlève les accents
            .replace(/[^\w\d_\-]/g, "_");    // remplace tout sauf lettres, chiffres, _ et - par _

        const nom_site_sain = sanitize(bilan.site.nom);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename=fiche_travaux_${bilan.objectifs[0].obj_ope_str}-${nom_site_sain}.docx`);
        res.send(buffer);
    } catch (error) {
        console.error("Erreur lors de la génération du Word :", error); // Log complet côté serveur
        res.status(500).json({
            error: error.message,
            stack: error.stack,
            details: error // Pour avoir tout l'objet erreur si besoin
        });
    }
});

module.exports = router;
