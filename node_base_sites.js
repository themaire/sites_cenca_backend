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
    const results = await pool.query(param['query']);
    if (results.rows.length === 0){
        callback("Pas de documents trouvés.", [])
    } else if (results.rows.length > 0 ){
        console.log("On a des résultats.");
        console.log("Params : ", param);
        callback(param["message"], results.rows);
    } else callback(param["message"], []);
};

function queryMaker(params){
  // Prends en paramètre les parametres de l'url recue
  // Retourne un query objet que la biliotheque pg acceptera 

  let query = {
    // text: 'SELECT uuid_site, code, prem_ctr, typ_site, typ_site_txt, milieux_naturels, communes, insee, bassin_agence, responsable, nom, espace, statut, fin, alerte_fin, validite
    text: 'SELECT uuid_site, code, nom, statut, communes, milieux_naturels, bassin_agence, prem_ctr, fin, responsable, validite, typ_site, typ_site_txt FROM sitcenca.listesitescenca ',
    // values: ['Brian', 'Carlson'],
    values: [],
    rowMode: 'array',
  };

  // Temp init.
  let whereFilters = new Array();
  let reqKeycptField = 1;
  let where = 'where ';
  let andOrEnd = " and ";

  if(params.type != "*") whereFilters.push({"typ_site": params.type});
  if(params.code != "*") whereFilters.push({"code": params.code});
  if(params.nom != "*") whereFilters.push({"nom": params.nom});
  if(params.commune != "*") whereFilters.push({"communes": params.commune});
  if(params.resp != "*") whereFilters.push({"responsable": params.resp});

  // Remplit le query object en fonction des valeurs données en parametre
  // Si on est au dernier element de la liste, on ne rajoutera pas le "and " dans le for pour le where
  for (const [key, value] of Object.entries(whereFilters)) {
    let reqKey = parseInt(key) + 1;
    if(reqKey == Object.keys(whereFilters).length) andOrEnd = ";";
    where += Object.keys(value)[0] + " = $" + reqKey + andOrEnd;
    query.values.push(Object.values(value)[0]);
  }
  query.text += where;
  // console.log(query);
  return query;
};

async function run() {
  try {

    // FONCTIONNE !
    // const paramTest = { query : 'SELECT * from esp.geometries limit 2;', message: 'Simple query test'};
    // siteResearch(pool, paramTest, (message, res) => {
    //   console.log(res);
    // });

    app.get("/sites/criteria/:type/:code/:nom/:commune/:resp", (req, res) => {
        const queryObject = queryMaker(req.params);
  
        siteResearch(pool, {message: "/sites/criteria/type/code...", query: queryObject}, 
        (message, resultats) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application.json; charset=utf-8');
          if (resultats.length > 0) {
            var json = JSON.stringify(resultats);
            // console.log(json);
            res.end(json);
          }else{
            let message = "erreur, la requête s'est mal exécutée. ";
            res.end(message);
            console.log(message);
          }
        });
      });

  } catch (error) {
    console.error("Error try :" + error);
    pool.end();
  }
}

run().catch(console.dir);