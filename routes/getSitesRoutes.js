const express = require('express');
const router = express.Router();

// const { authenticateToken } = require('../fonctions/fonctionsAuth.js'); 

// Fonctions et connexion à PostgreSQL
const { joinQuery, selectQuery, ExecuteQuerySite, distinctSiteResearch, executeQueryAndRespond, reset } = require('../fonctions/fonctionsSites.js'); 
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
        "espa.id_source, espa.id_crea, espa.url, espa.maj_admin, ST_AsGeoJSON( ST_Transform( geo.geom, 4326 ) ) geojson ";

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
    SelectFields += "commune as insee, com.nom ";
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

// Les projets version web
router.get('/projets/uuid=:uuid/:mode', (req, res) => {
    let { SelectFields, FromTable, where, message } = reset();
    message = "sites/projets/uuid/" + req.params.mode;
    SelectFields = 'SELECT ';

    if (req.params.mode == 'lite') {
        SelectFields += 'uuid_ope, uuid_proj, responsable, annee, date_deb, projet, action, typ_interv, statut, webapp, uuid_site '
        FromTable = 'FROM ope.synthesesites ';
        where = 'where cd_localisation = $1';
    } else if (req.params.mode == 'full') {
        SelectFields += 'uuid_proj, code, itin_tech, validite, document, programme, nom, perspectives, annee, statut, responsable, typ_projet, createur, date_crea, site, pro_debut, pro_fin, pro_pression_ciblee, pro_typ_objectif, pro_enjeux_eco, pro_nv_enjeux, pro_obj_ope, pro_surf_totale, pro_maitre_ouvrage, ref_loc_id, loc_poly as geom ';
        FromTable = 'FROM opegerer.projets LEFT JOIN opegerer.localisation_tvx ON opegerer.projets.ref_loc_id = opegerer.localisation_tvx.loc_id ';
        where = 'where uuid_proj = $1;';
    }

    executeQueryAndRespond(pool, SelectFields, FromTable, where, req.params.uuid, res, message, req.params.mode); // Retourne un ou plusieurs résultats
});


// Les operations version web
router.get('/operations/uuid=:uuid/:mode', (req, res) => {
    let { SelectFields, FromTable, where, message, json } = reset();
    message = "sites/operation/uuid/" + req.params.mode;

    if (req.params.mode == 'lite') {
        SelectFields = 'SELECT uuid_ope, code, titre, description, surf, date_debut ';
        where = 'where ref_uuid_proj = $1;';
    } else if (req.params.mode == 'full') {
        SelectFields = 'SELECT uuid_ope, code, titre, inscrit_pdg, rmq_pdg, description, interv_zh, surf, lin, app_fourr, pression_moy, ugb_moy, nbjours, charge_moy, charge_inst, remarque, validite, action, objectif, typ_intervention, date_debut, date_fin, date_approx, ben_participants, ben_heures, ref_uuid_proj, date_ajout, ref_loc_id ';
        where = 'where uuid_ope = $1;';
    }
    FromTable = 'FROM opegerer.operations ';

    executeQueryAndRespond(pool, SelectFields, FromTable, where, req.params.uuid, res, message, req.params.mode); // Retourne un ou plusieurs résultats
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
router.get('/selectvalues=:list', (req, res) => {
    let { SelectFields, FromTable, where, message, json } = reset();
    const list = req.params.list;
    message = "/sites/selectvalues/" + list;
    let order = undefined;

    console.log("Demande de la liste de choix de la table " + list);

    SelectFields = 'SELECT ';

    const simpleTables = ['ope.typ_actions', 'ope.typ_financeurs', 'ope.typ_projets', 'ope.typ_roles', 'opegerer.typ_enjeux', 'opegerer.typ_hydrauliques', 'opegerer.typ_infrastructures', 'opegerer.typ_mecaniques', 'opegerer.typ_objectifope', 'opegerer.typ_objectifs'];

    if (simpleTables.includes(list)) {
        SelectFields += 'cd_type, libelle ';
    }else if (list == 'ope.actions') {
        SelectFields += 'cd_action as cd_type, niveau, cd_sup, libelle, commentaire ';
        order = 'libelle';
    }else if (list == 'ope.programmes') {
        SelectFields += 'cd_prog as cd_type, nom, annee, statut ';
    }else if (list == 'ope.typ_interventions') {
        SelectFields += 'cd_type, lib_type as libelle ';
    }else if (list == 'opegerer.typ_amenagements') {
        SelectFields += 'cd_type as cd_type, libelle, categorie, libelle_pluriel ';
    }else if (list == 'typ_travauxsol') {
        SelectFields += 'cd_type, libelle, val_tri, val_filtre, libelle_pluriel ';
    }else if (list == 'opegerer.typ_troupeaux') {
        SelectFields += 'cd_type, libelle, coef_ugb, right(cd_supra,3) as code_supp, niveau ';
    }
    FromTable = 'FROM ' + list + ' ';
    
    if (order !== undefined) {
        where = 'order by ' + order;
    }else {
        where = 'order by val_tri;';
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

module.exports = router;
