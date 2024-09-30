"use strict";

const express = require('express');
const router = express.Router();

// Route pour la création d'un utilisateur
router.post('/register', (req, res) => {
  // Logique pour créer un utilisateur
  res.send('Utilisateur créé');
});

// Route pour le login
router.post('/login', (req, res) => {
  // Logique pour le login
  res.send('Utilisateur connecté');
});

module.exports = router;

var express = require("express");
var axios = require("axios"); // Utiliser axios pour les requêtes HTTP
var app = express();
var cors = require("cors");
app.listen(8889);
app.use(cors()); // Pour permettre le cross origin

// Create a new Postgresql client
const { Client, Pool } = require("pg");
const dbConfig = {
  user: "postgres",
  host: "localhost",
  database: "lizmap_cenca_maps",
  password: "postgres",
  port: 5432,
};
const pool = new Pool(dbConfig);
pool
  .connect()
  .then(() => {
    console.log("Connected to PostgreSQL database");
  })
  .catch((err) => {
    console.error("Error connecting to PostgreSQL database", err);
  });
// The Pool is ready to serve various query depending

// Functions
function joinQuery(select, from, where = "") {
  const query = select + from + where;

  // console.log(query);

  return query;
}

async function siteResearch(pool, param, callback) {
  const RESULTS = await pool.query(param["query"]);
  if (RESULTS.rows.length === 0) {
    callback("Pas de documents trouvés.", []);
  } else if (RESULTS.rows.length > 0) {
    console.log(" ");
    console.log("Résultats depuis la fonction siteResearch()");
    console.log("Params : ", param);
    console.log(RESULTS.rows.length + " résultats.");
    callback(param["message"], RESULTS.rows);
  } else callback(param["message"], []);
}

function selectSiteQuery(params) {
  // Prends en paramètre les parametres de l'url recue
  // Retourne un query objet que la biliotheque pg acceptera

  let SelectFields = "SELECT ";
  SelectFields +=
    "uuid_site, code, nom, statut, communes, milieux_naturels, bassin_agence, prem_ctr, fin, responsable, validite, typ_site, typ_site_txt ";
  let FromTable = "FROM sitcenca.listesitescenca ";

  let query = {
    // text: 'SELECT uuid_site, code, prem_ctr, typ_site, typ_site_txt, milieux_naturels, communes, insee, bassin_agence, responsable, nom, espace, statut, fin, alerte_fin, validite
    //text: 'SELECT uuid_site, code, nom, statut, communes, milieux_naturels, bassin_agence, prem_ctr, fin, responsable, validite, typ_site, typ_site_txt FROM sitcenca.listesitescenca',
    text: joinQuery(SelectFields, FromTable, ""),
    values: [],
    // rowMode: 'array',
  };

  // Temp init.
  let whereFilters = new Array();
  let where = " where ";
  let andOrEnd = " and ";

  if (params.type != "*") whereFilters.push({ typ_site: params.type });
  if (params.code != "*") whereFilters.push({ code: params.code });
  if (params.nom != "*")
    whereFilters.push({ nom: decodeURIComponent(params.nom) });
  if (params.commune != "*") whereFilters.push({ communes: params.commune });
  if (params.milnat != "*")
    whereFilters.push({ milieux_naturels: decodeURIComponent(params.milnat) });
  if (params.resp != "*") whereFilters.push({ responsable: params.resp });

  // if(params.uuid_site != undefined) whereFilters.push({"uuid_site": params.uuid_site});

  if (Object.keys(whereFilters).length == 0) {
    query.text += ";";
    return query;
  } else {
    // Remplit le query object en fonction des valeurs données en parametre
    // Si on est au dernier element de la liste, on ne rajoutera pas le "and " dans le for pour le where
    for (const [key, value] of Object.entries(whereFilters)) {
      let reqKey = parseInt(key) + 1;
      if (reqKey == Object.keys(whereFilters).length) andOrEnd = ";";
      where += Object.keys(value)[0] + " = $" + reqKey + andOrEnd;
      query.values.push(Object.values(value)[0]);
    }
    query.text += where;
    console.log(query);
    return query;
  }
}

async function distinctSiteResearch(
  pool,
  selectors,
  property,
  title,
  callback
) {
  const QUERY = {
    text: "SELECT DISTINCT " + property + " FROM sitcenca.listesitescenca;",
    values: [],
    // rowMode: 'array',
  };

  const ResultValues = await pool.query(QUERY);

  if (ResultValues.length === 0) selectors.push({ name: property, values: [] });
  else {
    if (ResultValues !== undefined) {
      let values = [];
      for (let value of ResultValues.rows) {
        if (value[property] !== null) values.push(value[property]);
      }
      selectors.push({
        name: property,
        title: title,
        // "values": ResultValues.sort()});
        values: values.sort(),
      });
      callback(selectors);
    }
  }
}

async function run() {
  try {
    // FONCTIONNE !
    // const paramTest = { query : 'SELECT * from esp.geometries limit 2;', message: 'Simple query test'};
    // siteResearch(pool, paramTest, (message, res) => {
    //   console.log(res);
    // });

    app.get(
      "/sites/criteria/:type/:code/:nom/:commune/:milnat/:resp",
      (req, res) => {
        const queryObject = selectSiteQuery(req.params); // Fabrique la requete avec son where en fonction des req.prams

        siteResearch(
          pool,
          { message: "/sites/criteria/type/code...", query: queryObject },
          (message, resultats) => {
            if (resultats.length > 0) {
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
    app.get("/sites/uuid=:uuid", (req, res) => {
      const UUID = req.params.uuid;
      // let json = JSON.stringify({});

      let SelectFields = "SELECT ";
      SelectFields +=
        "site.uuid_site, site.code, site.prem_ctr, site.ref_fcen, site.pourc_gere, site.surf_actes, site.url_cen, site.validite, site.espace, site.typ_site, ";
      SelectFields +=
        "site.responsable, site.date_crea as date_crea_site, site.id_mnhn, site.modif_admin, site.actuel, site.url_mnhn, site.parties_gerees, site.typ_ouverture, site.description_site, ";
      SelectFields +=
        "site.sensibilite, site.remq_sensibilite, site.ref_public,";
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

      siteResearch(
        pool,
        { query: queryObject, message: "sites/uuid" },
        (message, resultats) => {
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          if (resultats !== undefined && resultats[0] !== undefined) {
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
    app.get("/sites/commune/uuid=:uuid", (req, res) => {
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

      siteResearch(
        pool,
        { query: queryObject, message: "sites/commune/uuid" },
        (message, resultats) => {
          if (resultats.length > 0) {
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
    app.get("/sites/pgestion/uuid=:uuid", (req, res) => {
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

      siteResearch(
        pool,
        { query: queryObject, message: "sites/pgestion/uuid" },
        (message, resultats) => {
          if (resultats.length > 0) {
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
    app.get("/sites/milnat/uuid=:uuid", (req, res) => {
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

      siteResearch(
        pool,
        { query: queryObject, message: "sites/milnat/uuid" },
        (message, resultats) => {
          if (resultats.length > 0) {
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
    app.get("/sites/mfu/uuid=:uuid", (req, res) => {
      const SelectFields =
        "SELECT site, uuid_acte, debut, fin, tacit_rec, typ_mfu, actuel, url, types_prop, surface ";
      const FromTable = "FROM sitcenca.listeactes ";
      const where = "where site = $1 order by debut";

      const UUID = req.params.uuid;
      const queryObject = {
        text: joinQuery(SelectFields, FromTable, where),
        values: [UUID],
      };

      siteResearch(
        pool,
        { query: queryObject, message: "sites/mfu/uuid" },
        (message, resultats) => {
          if (resultats.length > 0) {
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

    // Projets lite
    app.get('/sites/projetslite/uuid=:uuid', (req, res) => {
      const SelectFields = 'SELECT uuid_ope, uuid_proj, responsable, annee, date_deb, projet, action, typ_interv, statut, webapp '
      const FromTable = 'FROM ope.synthesesites ';
      const where = 'where cd_localisation = $1';

      const UUID = req.params.uuid;
      const queryObject = {
        text: joinQuery(SelectFields, FromTable, where),
        values: [UUID]
      };

      siteResearch(pool, {query: queryObject, "message": "sites/operations/uuid"},
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
    app.get('/sites/projets/uuid=:uuid', (req, res) => {
      const SelectFields = 'SELECT uuid_proj, code, itin_tech, validite, document, programme, nom, perspectives, annee, statut, responsable, typ_projet, createur, date_crea, site, pro_debut, pro_fin, pro_geom, pro_pression_ciblee, pro_typ_objectif, pro_enjeux_eco, pro_nv_enjeux, pro_obj_ope, pro_obj_projet, pro_surf_totale ';
      const FromTable = 'FROM opegerer.projets ';
      const where = 'where uuid_proj = $1';

      const UUID = req.params.uuid;
      const queryObject = {
        text: joinQuery(SelectFields, FromTable, where),
        values: [UUID]
      };

      siteResearch(pool, {query: queryObject, "message": "sites/projetsv/uuid"},
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

    // Menu
    app.get("/menu/parent=:parent", (req, res) => {
      const SelectFields =
        "SELECT men_id as id, men_name as name, men_class_color as class_color, men_parent as parent, men_route as route, men_accueil as accueil, men_url as url , men_description as description, men_picture as picture, men_date_added as date_added, men_opened as opended ";
      const FromTable = "FROM gestint.menu_header ";
      let where;
      let queryObject;

      const parent = req.params.parent;

      if (req.params.parent == "null") {
        where = "where men_parent is null";
        queryObject = {
          text: joinQuery(
            SelectFields,
            FromTable,
            where + " order by men_order"
          ),
          values: [], // Pas de valeurs à passer pour une condition "is null"
        };
      } else {
        where = "where men_parent = $1";
        queryObject = {
          text: joinQuery(SelectFields, FromTable, where),
          values: [parent],
        };
      }

      // fiche Acte
      app.get("/sites/uuid_acte=:uuid_acte", (req, res) => {
        const SelectFields =
          "SELECT uuid_acte, debut, fin, tacit_rec, detail_rec, notaire, cout, remarque, validite, date_crea, date_modif, typ_mfu, tmfu.libelle as typ_mfu_lib, site, url, actuel ";
        let FromTable = "FROM sitcenca.actes_mfu";
        FromTable +=
          " LEFT JOIN sitcenca.tmfu as tmfu on typ_mfu = tmfu.cd_type ";
        const where =
          "where actes_mfu.uuid_acte = $1 order by pourcentage desc";

        // console.log("queryObject : ", queryObject);

        siteResearch(
          pool,
          { query: queryObject, message: "/sites/uuid_acte" },
          (message, resultats) => {
            if (resultats.length > 0) {
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

      // console.log("queryObject : ", queryObject);

      siteResearch(
        pool,
        { query: queryObject, message: "menu/parent" },
        (message, resultats) => {
          if (resultats.length > 0) {
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
    app.get("/getip", async (req, res) => {
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
    app.get("/sites/selectors", (req, res) => {
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
  } catch (error) {
    console.error("Error try :" + error);
    pool.end();
  }
}

run().catch(console.dir);
