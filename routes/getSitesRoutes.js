const express = require('express');
const router = express.Router();


// Fonctions et connexion à PostgreSQL
const { joinQuery, selectQuery, ExecuteQuerySite, distinctSiteResearch } = require('../fonctions/fonctionsSites.js'); 
const pool = require('../dbPool/poolConnect.js');


// FONCTIONNE !
    // const paramTest = { query : 'SELECT * from esp.geometries limit 2;', message: 'Simple query test'};
    // selectSite(pool, paramTest, (message, res) => {
    //   console.log(res);
    // });

router.get(
    "/criteria/:type/:code/:nom/:commune/:milnat/:resp",
    (req, res) => {
        const queryObject = selectQuery(req.params); // Fabrique la requete avec son where en fonction des req.prams

        ExecuteQuerySite(
            pool,
            { message: "/sites/criteria/type/code...", query: queryObject },
            "select",
            (message, resultats) => {
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
    const UUID = req.params.uuid;
    // let json = JSON.stringify({});

    let SelectFields = "SELECT ";
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

    let FromTable = "FROM esp.espaces as espa ";
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
    const where = "where uuid_site = $1";

    const queryObject = {
        // text: 'SELECT uuid_site, code, nom, statut, communes, milieux_naturels, bassin_agence, prem_ctr, fin, responsable, validite, typ_site, typ_site_txt FROM sitcenca.listesitescenca where uuid_site = $1;',
        text: joinQuery(SelectFields, FromTable, where),
        values: [UUID],
        // rowMode: 'array',
    };

    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "sites/uuid" },
        "select",
        (message, resultats) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        if (resultats.length > 0 || message == "ok") {
            var json = JSON.stringify(resultats[0]);
            res.end(json);
            console.log("message : " + message);
        } else {
            let message = "erreur, la requête s'est mal exécutée. ";
            console.log(queryObject.text);
            console.log(queryObject.values[UUID]);
            console.log(message);
            res.end("");
        }
        }
    );
});

// Communes
router.get("/commune/uuid=:uuid", (req, res) => {
    let SelectFields = "SELECT ";
    // SelectFields += 'commune as insee, com.nom_officiel '
    SelectFields += "commune as insee, com.nom ";
    let FromTable = "FROM esp.localisations loca ";
    FromTable +=
        "left join esp.espaces espa on loca.espace = espa.uuid_espace ";
    FromTable +=
        "left join sitcenca.sites site on espa.uuid_espace = site.espace ";
    //FromTable += 'left join bd_topo.commune com on loca.commune = com.code_insee ';
    FromTable +=
        "left join terr.listecommunes com on loca.commune = com.insee_com ";
    const where = "where site.uuid_site = $1 order by com.nom";

    const UUID = req.params.uuid;
    const queryObject = {
        text: joinQuery(SelectFields, FromTable, where),
        values: [UUID],
    };

    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "sites/commune/uuid" },
        "select",
        (message, resultats) => {
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

// Plans de gestion
router.get("/pgestion/uuid=:uuid", (req, res) => {
    let SelectFields = "SELECT ";
    SelectFields +=
        "uuid_doc, document, annee_deb, annee_fin, docactuel, url, surface ";
    let FromTable = "FROM docplan.docplanifsites ";
    const where = "where uuid_site = $1 order by docactuel";

    const UUID = req.params.uuid;
    const queryObject = {
        text: joinQuery(SelectFields, FromTable, where),
        values: [UUID],
    };

    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "sites/pgestion/uuid" },
        "select",
        (message, resultats) => {
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

// Milieux naturels
router.get("/milnat/uuid=:uuid", (req, res) => {
    const SelectFields =
        'SELECT typmilnat.libelle as "type_milieu", milnat.pourcentage ';
    let FromTable = "FROM esp.espaces espa ";
    FromTable +=
        "left join sitcenca.sites site on espa.uuid_espace = site.espace ";
    FromTable +=
        "left join esp.milieux_naturels milnat on espa.uuid_espace = milnat.espace ";
    FromTable +=
        "left join esp.typ_milieuxnat typmilnat on milnat.typ_milieu = typmilnat.cd_type ";
    const where = "where site.uuid_site = $1 order by pourcentage desc";

    const UUID = req.params.uuid;
    const queryObject = {
        text: joinQuery(SelectFields, FromTable, where),
        values: [UUID],
    };

    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "sites/milnat/uuid" },
        "select",
        (message, resultats) => {
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

// MFU
router.get("/miniacte/uuid=:uuid", (req, res) => {
    const SelectFields =
        "SELECT site, uuid_acte, debut, fin, tacit_rec, typ_mfu, actuel, url, types_prop, surface ";
    const FromTable = "FROM sitcenca.listeactes ";
    const where = "where site = $1 order by debut;";

    const UUID = req.params.uuid;
    const queryObject = {
        text: joinQuery(SelectFields, FromTable, where),
        values: [UUID],
    };

    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "sites/mfu/uuid" },
        "select",
        (message, resultats) => {
        if (resultats.length > 0 ) {
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

// MFU fiche de la vraie table MFU ATTETION renvoit UN SEUL élement et pas une liste d'element comme d'habitude
router.get("/fullmfu/uuid=:uuid", (req, res) => {
    const SelectFields =
        "select amfu.uuid_acte, amfu.debut, amfu.fin, amfu.tacit_rec, amfu.detail_rec, amfu.notaire, amfu.cout, amfu.remarque, amfu.validite, amfu.date_crea, amfu.date_modif, amfu.typ_mfu, amfu.site, amfu.url, amfu.actuel, e.nom as nom_site ";
    let FromTable = "FROM sitcenca.actes_mfu AS amfu ";
    FromTable += "LEFT JOIN sitcenca.sites s ON amfu.site = s.uuid_site ";
    FromTable += "LEFT JOIN esp.espaces e ON s.espace = e.uuid_espace ";
    const where = "where amfu.uuid_acte = $1;";

    const UUID = req.params.uuid;
    const queryObject = {
        text: joinQuery(SelectFields, FromTable, where),
        values: [UUID],
    };

    ExecuteQuerySite(
        pool,
        { query: queryObject, message: "sites/fullmfu/uuid" },
        "select",
        (message, resultats) => {
        if (resultats.length > 0 ) {
            const json = JSON.stringify(resultats[0]);
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

// Projets lite
router.get('/projetslite/uuid=:uuid', (req, res) => {
    const SelectFields = 'SELECT uuid_ope, uuid_proj, responsable, annee, date_deb, projet, action, typ_interv, statut, webapp, uuid_site '
    const FromTable = 'FROM ope.synthesesites ';
    const where = 'where cd_localisation = $1';

    const UUID = req.params.uuid;
    const queryObject = {
        text: joinQuery(SelectFields, FromTable, where),
        values: [UUID]
    };

    ExecuteQuerySite(pool, {query: queryObject, "message": "sites/operations/uuid"}, "select",
    (message, resultats) => {
    if (resultats.length > 0) {
            const json = JSON.stringify(resultats);
            // console.log(json);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(json);
        }else{
            const json = JSON.stringify([]);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(json);
        }
    });
});

// Les projets version web
router.get('/projets/uuid=:uuid', (req, res) => {
    const SelectFields = 'SELECT uuid_proj, code, itin_tech, validite, document, programme, nom, perspectives, annee, statut, responsable, typ_projet, createur, date_crea, site, pro_debut, pro_fin, pro_geom, pro_pression_ciblee, pro_typ_objectif, pro_enjeux_eco, pro_nv_enjeux, pro_obj_ope, pro_obj_projet, pro_surf_totale, pro_maitre_ouvrage ';
    const FromTable = 'FROM opegerer.projets ';
    const where = 'where uuid_proj = $1;';

    const UUID = req.params.uuid;
    const queryObject = {
        text: joinQuery(SelectFields, FromTable, where),
        values: [UUID]
    };

    ExecuteQuerySite(pool, {query: queryObject, "message": "sites/projets/uuid"}, "select",
        (message, resultats) => {
            if (resultats.length == 1) {
                const json = JSON.stringify(resultats);
                // console.log(json);
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(json);
            }else{
                const json = JSON.stringify([]);
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(json);
            }
        });
});
// Les projets version web
router.get('/operations/uuid=:uuid', (req, res) => {
    const SelectFields = 'SELECT uuid_ope, code, titre, inscrit_pdg, rmq_pdg, description, interv_zh, surf, lin, app_fourr, pression_moy, ugb_moy, nbjours, charge_moy, charge_inst, remarque, validite, action, objectif, typ_intervention, date_debut, date_fin, date_approx, ben_participants, ben_heures, pro_geom, ref_uuid_proj ';
    const FromTable = 'FROM opegerer.operations ';
    const where = 'where ref_uuid_proj = $1;';

    const UUID = req.params.uuid;
    const queryObject = {
        text: joinQuery(SelectFields, FromTable, where),
        values: [UUID]
    };

    ExecuteQuerySite(pool, {query: queryObject, "message": "sites/operation/uuid"}, "select",
        (message, resultats) => {
            if (resultats.length > 0) {
                const json = JSON.stringify(resultats);
                // console.log(json);
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(json);
            }else{
                const json = JSON.stringify([]);
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(json);
            }
        });
});



// fiche Acte
router.get("/uuid_acte=:uuid_acte", (req, res) => {
    const SelectFields =
    "SELECT uuid_acte, debut, fin, tacit_rec, detail_rec, notaire, cout, remarque, validite, date_crea, date_modif, typ_mfu, tmfu.libelle as typ_mfu_lib, site, url, actuel ";
    let FromTable = "FROM sitcenca.actes_mfu";
    FromTable +=
    " LEFT JOIN sitcenca.tmfu as tmfu on typ_mfu = tmfu.cd_type ";
    const where =
    "where actes_mfu.uuid_acte = $1 order by pourcentage desc";

    // console.log("queryObject : ", queryObject);

    ExecuteQuerySite(
    pool,
    { query: queryObject, message: "/sites/uuid_acte" },
    "select",
    (message, resultats) => {
        if (resultats.length > 0 || resultats !== false) {
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
                        let json = JSON.stringify(selectors);
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


module.exports = router;
