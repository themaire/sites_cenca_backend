function joinQuery(select, from, where = "") {
    const query = select + from + where;

    // console.log(query);

    return query;
}

// Pour les requetes SELECT et UPDATE
async function ExecuteQuerySite(pool, param, type = "select", callback) {
    /**
     * Exécute une requête SQL sur la base de données et traite les résultats.
     * 
     * @param {Object} pool - Le pool de connexions à la base de données.
     * @param {Object} param - Les paramètres de la requête, incluant la requête SQL et un message.
     * @param {string} [type="select"] - Le type de requête (par défaut "select").
     * @param {Function} callback - La fonction de rappel à exécuter avec les résultats de la requête.
     */

    type = type.toLowerCase();

    try {
        // Exécute la requête SQL avec les paramètres fournis
        const RESULTS = await pool.query(param["query"]);
        const nbLignes = RESULTS.rowCount;

        // Si aucune ligne n'est retournée ou si le type est "update"
        if (nbLignes === 0 || ["update", "insert", "delete"].includes(type)) {
            callback("ok", RESULTS.rows);
        } else if (nbLignes > 0) {
            // Si des lignes sont retournées, affiche les résultats et appelle le callback avec les données
            console.log(" ");
            console.log("Résultats depuis la fonction ExecuteQuerySite()");
            console.log("Params : ", param);
            console.log(nbLignes + " résultats.");
            callback(param["message"], RESULTS.rows);
        } else {
            // Si aucune condition n'est remplie, appelle le callback avec un message et une liste vide
            callback(param["message"], []);
        }
    } catch (error) {
        // En cas d'erreur, affiche l'erreur et appelle le callback avec un message d'erreur et une liste vide
        console.error("Erreur lors de l'exécution de la requête : ", param["query"]);
        console.error("Erreur de PostgreSQL : ", error);
        if (typeof callback === 'function') {
            callback("Erreur lors de l'exécution de la requête :", []);
        } else {
            console.error("Callback is not a function");
        }
    }
}

function selectQuery(params) {
    // Prends en paramètre les parametres de l'url recue
    // Retourne un query objet que la bibliotheque pg acceptera

    let SelectFields = "SELECT ";
    SelectFields +=
        "uuid_site, code, nom, statut, communes, milieux_naturels, bassin_agence, prem_ctr, fin, responsable, validite, typ_site, typ_site_txt ";
    let FromTable = "FROM sitcenca.listesitescenca ";

    let query = {
        // text: 'SELECT uuid_site, code, prem_ctr, typ_site, typ_site_txt, milieux_naturels, communes, insee, bassin_agence, responsable, nom, espace, statut, fin, alerte_fin, validite
        //text: 'SELECT uuid_site, code, nom, statut, communes, milieux_naturels, bassin_agence, prem_ctr, fin, responsable, validite, typ_site, typ_site_txt FROM sitcenca.listesitescenca',
        text: joinQuery(SelectFields, FromTable),
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

            // Completer la variable where (l'allonger)
            where += Object.keys(value)[0] + " = $" + reqKey + andOrEnd;

            // Ajouter les valeurs de la liste des valeurs
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

module.exports = { joinQuery, ExecuteQuerySite, selectQuery, distinctSiteResearch };