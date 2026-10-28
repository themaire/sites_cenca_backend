// Sites : recherche, fiche site, communes, milieux naturels, conservateurs
// Monté sur /sites dans node_base_sites.js
const express = require("express");
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const { selectQuery, ExecuteQuerySite, distinctSiteResearch, executeQueryAndRespond, reset } = require("../../fonctions/fonctionsSites.js");
const pool = require("../../dbPool/poolConnect.js");

// Liste des sites diffusables (GeoJSON) pour le site vitrine (studio web externe)
// Accès protégé par une clé statique passée en paramètre GET "key" (DIFFUSION_API_KEY)
router.get("/sites_diffusables", async (req, res) => {
    const apiKey = req.query.key;

    if (!apiKey || apiKey !== process.env.DIFFUSION_API_KEY) {
        return res.status(401).json({ error: "Clé d'accès manquante ou invalide." });
    }

    const sql = `
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(json_agg(
                json_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(ST_Transform(ST_PointOnSurface(geom), 4326))::json,
                    'properties', json_build_object(
                        'nom_site', nom_site,
                        'code_site', code_site,
                        'commune', commune,
                        'surface', surface,
                        'milieu_naturel_principal', milieu_naturel_principal
                    )
                )
            ) FILTER (WHERE geom IS NOT NULL), '[]')
        ) AS geojson
        FROM sitcenca.v_sites_diffusable;
    `;

    try {
        const result = await pool.query(sql);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.status(200).json(result.rows[0]?.geojson || { type: "FeatureCollection", features: [] });
    } catch (err) {
        console.error("Erreur SQL /sites/sites_diffusables:", err);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la récupération des sites diffusables.",
            detail: err.message,
        });
    }
});

// :annee (facultatif) = année de création du site (prem_ctr) ; absent ou "*" = toutes les années
router.get("/criteria/:type/:code/:nom/:commune/:milnat/:resp/:annee?", (req, res) => {
    if (req.params.annee !== undefined && req.params.annee !== "*" && !/^\d{4}$/.test(req.params.annee)) {
        return res.status(400).json({ success: false, message: "Année invalide : " + req.params.annee });
    }
    // A FAIRE POUR PLUS TARD : adapter la fonction executeQueryAndRespond() (utilisée de partout sur toutes le routes) pour qu'elle puisse prendre en compte les paramètres de la requête

    const queryObject = selectQuery(req.params); // Fabrique la requete avec son where en fonction des req.params
    console.log(
        "Requête pour les critères de recherche de sites : " +
        JSON.stringify(queryObject)
    );

    ExecuteQuerySite(
        pool,
        { message: "/sites/criteria/type/code...", query: queryObject },
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


// Données d'un site par son uuid
router.get("/uuid=:uuid", (req, res) => {
    let { SelectFields, FromTable, where, message, json } = reset();
    message = "sites/uuid";

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
        "LEFT JOIN esp.geometries as geo ON geo.espace = espa.uuid_espace AND geo.validite IS NOT FALSE ";
    FromTable +=
        "LEFT JOIN esp.typ_geomnatures geona ON geo.typ_nature = geona.cd_type ";
    where = "where uuid_site = $1";

    executeQueryAndRespond(
        pool,
        SelectFields,
        FromTable,
        where,
        req.params.uuid,
        res,
        message,
        (mode = "full")
    ); // Full car on veut un seul résultat
});

// Site(s) d'un code site, sans tenir compte des majuscules ni des espaces (liens /site/<code> du chatbot).
// Tableau vide si code inconnu, plusieurs lignes si le code est en double (ex. 08SECH01)
router.get("/code=:code", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.uuid_site, s.code, e.nom
               FROM sitcenca.sites s
               LEFT JOIN esp.espaces e ON e.uuid_espace = s.espace
              WHERE upper(trim(s.code)) = upper(trim($1))
              ORDER BY s.validite IS FALSE, e.nom`,
            [req.params.code]
        );
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur lors de la recherche du site de code " + req.params.code + " :", error);
        return res.status(500).json({ success: false, message: "Erreur lors de la recherche du site par son code.", code: 1 });
    }
});

// Conservateurs bénévoles du site (contacts de l'annuaire, via sitcenca.conservateurs)
router.get("/conservateur/uuid_site=:uuid_site", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT a.uuid_ann, a.nom, a.telephone, a.mail, a.adresse
               FROM sitcenca.conservateurs c
               JOIN ann.annuaire a ON a.uuid_ann = c.societe
              WHERE c.site = $1
              ORDER BY a.nom`,
            [req.params.uuid_site]
        );
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur lors de la lecture des conservateurs du site " + req.params.uuid_site + " :", error);
        return res.status(500).json({ success: false, message: "Erreur lors de la lecture des conservateurs du site.", code: 1 });
    }
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
    SelectFields +=
        "WHEN LEFT(commune,2) = '52' THEN 'Haute-Marne' END AS departement ";
    FromTable = "FROM esp.localisations loca ";
    FromTable +=
        "left join esp.espaces espa on loca.espace = espa.uuid_espace ";
    FromTable +=
        "left join sitcenca.sites site on espa.uuid_espace = site.espace ";
    //FromTable += 'left join bd_topo.commune com on loca.commune = com.code_insee ';
    FromTable +=
        "left join terr.listecommunes com on loca.commune = com.insee_com ";
    where = "where site.uuid_site = $1 order by com.nom";

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


// SITE Selectors de la barre de recherche de sites par critères
router.get("/selectors_sites", (req, res) => {
    distinctSiteResearch(
        pool,
        'sitcenca.listesitescenca',
        [],
        "milieux_naturels",
        "Milieux naturels",
        (selectors) => {
            // Responsable affiché « Prénom Nom » (et non le code salarié) ; /criteria accepte les deux
            distinctSiteResearch(
                pool,
                `(SELECT concat(s.prenom, ' ', s.nom) AS responsable
                    FROM sitcenca.listesitescenca l
                    JOIN admin.salaries s ON s.cd_salarie = l.responsable) AS responsables`,
                selectors,
                "responsable",
                "Responsable",
                (selectors) => {
                    distinctSiteResearch(
                        pool,
                        'sitcenca.listesitescenca',
                        selectors,
                        "bassin_agence",
                        "Bassin agence",
                        (selectors) => {
                            // Année de création du site (année du premier contrat, sitcenca.sites.prem_ctr)
                            distinctSiteResearch(
                                pool,
                                'sitcenca.listesitescenca',
                                selectors,
                                "prem_ctr",
                                "Année de création",
                                // (selectors) => {
                                //     distinctSiteResearch(
                                // pool,
                                // 'sitcenca.listesitescenca',
                                // selectors,
                                // "fin",
                                // "Fin acte",
                                (selectors) => {
                                    const json =
                                        JSON.stringify(selectors);
                                    res.setHeader(
                                        "Access-Control-Allow-Origin",
                                        "*"
                                    );
                                    res.setHeader(
                                        "Content-type",
                                        "application/json; charset=UTF-8"
                                    );
                                    res.end(json);
                                    // }
                                    // );
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
