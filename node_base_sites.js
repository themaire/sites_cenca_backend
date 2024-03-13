"use strict";

var express = require('express');
var app     = express();
var cors = require('cors');
app.listen(8889);
app.use(cors()); // Pour permettre le cross origin

// Create a new Postgresql client
const { Client, Pool } = require('pg')
const dbConfig = {
    user: 'postgres',
    host: 'localhost',
    database: 'lizmap_cenca_maps',
    password: 'postgres',
    port: 5432,
};
const pool = new Pool( dbConfig );
pool.connect().then(() => {
        console.log('Connected to PostgreSQL database');
        })
        .catch((err) => {
            console.error('Error connecting to PostgreSQL database', err);
        });
// The Pool is ready to serve various query depending

// Functions
async function siteResearch(pool, param, callback){
    const RESULTS = await pool.query(param['query']);
    if (RESULTS.rows.length === 0){
        callback("Pas de documents trouvés.", [])
    } else if (RESULTS.rows.length > 0 ){
        console.log("On a des résultats.");
        console.log("Params : ", param);
        callback(param["message"], RESULTS.rows);
    } else callback(param["message"], []);
};

function selectSiteQuery(params){
  // Prends en paramètre les parametres de l'url recue
  // Retourne un query objet que la biliotheque pg acceptera 

  let query = {
    // text: 'SELECT uuid_site, code, prem_ctr, typ_site, typ_site_txt, milieux_naturels, communes, insee, bassin_agence, responsable, nom, espace, statut, fin, alerte_fin, validite
    text: 'SELECT uuid_site, code, nom, statut, communes, milieux_naturels, bassin_agence, prem_ctr, fin, responsable, validite, typ_site, typ_site_txt FROM sitcenca.listesitescenca',
    // values: ['Brian', 'Carlson'],
    values: [],
    rowMode: 'array',
  };

  // Temp init.
  let whereFilters = new Array();
  let where = ' where ';
  let andOrEnd = " and ";

  if(params.type != "*") whereFilters.push({"typ_site": params.type});
  if(params.code != "*") whereFilters.push({"code": params.code});
  if(params.nom != "*") whereFilters.push({"nom": decodeURIComponent( params.nom )});
  if(params.commune != "*") whereFilters.push({"communes": params.commune});
  if(params.milnat != "*") whereFilters.push({"milieux_naturels": decodeURIComponent( params.milnat )});
  if(params.resp != "*") whereFilters.push({"responsable": params.resp});

  if(Object.keys(whereFilters).length == 0){
    query.text += ";";
    return query;
  }else{
    // Remplit le query object en fonction des valeurs données en parametre
    // Si on est au dernier element de la liste, on ne rajoutera pas le "and " dans le for pour le where
    for (const [key, value] of Object.entries(whereFilters)) {
      let reqKey = parseInt(key) + 1;
      if(reqKey == Object.keys(whereFilters).length) andOrEnd = ";";
      where += Object.keys(value)[0] + " = $" + reqKey + andOrEnd;
      query.values.push(Object.values(value)[0]);
    }
    query.text += where;
    console.log(query);
    return query;
  }
};

async function distinctSiteResearch (pool, selectors, property, callback) {

  const QUERY = {
    text: 'SELECT DISTINCT ' + property + ' FROM sitcenca.listesitescenca;',
    values: [],
    // rowMode: 'array',
  };

  const ResultValues = await pool.query(QUERY);

  if (ResultValues.length === 0) selectors.push( {"name": property, "values": []} );
  else{
    if (ResultValues !== undefined){
      let values = [];
      for (let value of ResultValues.rows){
        if(value[property] !== null) values.push(value[property]);
      }
      selectors.push ({ "name" :  property,
                        // "values": ResultValues.sort()});
                        "values": values.sort()});
      callback(selectors);

    }
  }
};

async function run() {
  try {

    // FONCTIONNE !
    // const paramTest = { query : 'SELECT * from esp.geometries limit 2;', message: 'Simple query test'};
    // siteResearch(pool, paramTest, (message, res) => {
    //   console.log(res);
    // });

    app.get("/sites/criteria/:type/:code/:nom/:commune/:milnat/:resp", (req, res) => {
      const queryObject = selectSiteQuery(req.params); // Fabrique la requete avec son where en fonction des req.prams

      siteResearch(pool, {message: "/sites/criteria/type/code...", query: queryObject}, 
      (message, resultats) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application.json; charset=utf-8');
        if (resultats.length > 0) {
          const json = JSON.stringify(resultats);
          // console.log(json);
          res.end(json);
        }else{
          const json = JSON.stringify([]);
          res.end(json);
        }
      });
    });
    
    app.get('/sites/uuid=:uuid', (req, res) => {
      const ID = req.params.uuid;
      let json = JSON.stringify({});

      const queryObject = {
        // text: 'SELECT uuid_site, code, prem_ctr, typ_site, typ_site_txt, milieux_naturels, communes, insee, bassin_agence, responsable, nom, espace, statut, fin, alerte_fin, validite
        text: 'SELECT uuid_site, code, nom, statut, communes, milieux_naturels, bassin_agence, prem_ctr, fin, responsable, validite, typ_site, typ_site_txt FROM sitcenca.listesitescenca where uuid_site = $1;',
        values: [ID],
        rowMode: 'array',
      };

      siteResearch(pool, {query: queryObject, "message": "sites/uuid"}, 
      (message, resultats) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application.json; charset=utf-8');
        if (resultats !== undefined && resultats[0] !== undefined) {
          var json = JSON.stringify(resultats[0]);
          res.end(json);
          console.log("message : " + message);
        }else{
          let message = "erreur, la requête s'est mal exécutée. ";
          res.end(message);
          console.log(message);
        }
      });
    });
    
    app.get('/sites/selectors', (req, res) => {
      distinctSiteResearch(pool, [], "milieux_naturels",
        (selectors) => {
          distinctSiteResearch(pool, selectors, "responsable",
            (selectors) => {
              distinctSiteResearch(pool, selectors, "bassin_agence",
                (selectors) => {
                  distinctSiteResearch(pool, selectors, "prem_ctr",
                    (selectors) => {
                      distinctSiteResearch(pool, selectors, "fin",
                        (selectors) => {
                          let json=JSON. stringify (selectors) ;
                          res.setHeader('Access-Control-Allow-Origin', '*');
                          res.setHeader("Content-type", "application/json; charset=UTF-8");
                          res.end(json);
                      });
                  });
              });
          });
      });
    });

  } catch (error) {
    console.error("Error try :" + error);
    pool.end();
  }
}

run().catch(console.dir);