const shapefile = require("shapefile");

function joinQuery(select, from, where = "") {
    const query = select + from + where;

    // console.log(query);

    return query;
}

// Pour les requetes SELECT et UPDATE
async function ExecuteQuerySite(pool, param, type, callback) {
    /**
     * Exécute une requête SQL sur la base de données et traite les résultats.
     *
     * @param {Object} pool - Le pool de connexions à la base de données.
     * @param {Object} param - Les paramètres de la requête, incluant la { requête SQL : message }.
     * @param {string} type - Le type de requête (select, update...).
     * @param {Function} callback - La fonction de rappel à exécuter avec les résultats de la requête.
     */

    if (type === "string") type = type.toLowerCase();

    try {
        // Exécute la requête SQL avec les paramètres fournis
        const RESULTS = await pool.query(param["query"]);
        const nbLignes = RESULTS.rowCount;

        // Si aucune ligne n'est retournée ou si le type est "update" ou "insert" ou "delete", appelle le callback avec un message et une liste vide
        if (nbLignes >= 0 && ["update", "insert", "delete"].includes(type)) {
            callback([], "ok");
        } else if (nbLignes >= 0) {
            // Si des lignes sont retournées, affiche les résultats et appelle le callback avec les données
            console.log("Résultats depuis la fonction ExecuteQuerySite()");
            console.log("Params : ", param);
            console.log(nbLignes + " résultats.");
            callback(RESULTS.rows, param["message"]);
        } else {
            // Si aucune condition n'est remplie, appelle le callback avec un message et une liste vide
            console.log("aucune condition remplie");
            console.log("nbLignes : ", nbLignes);
            console.log("type : ", type);
            console.log(
                '["update", "insert", "delete"].includes(type) : ',
                ["update", "insert", "delete"].includes(type)
            );

            callback([], param["message"]);
        }
    } catch (error) {
        // En cas d'erreur, affiche l'erreur et appelle le callback avec un message d'erreur et une liste vide
        console.error(
            "Erreur lors de l'exécution de la requête : ",
            param["query"]
        );
        console.error("Erreur de PostgreSQL : ", error);
        if (typeof callback === "function") {
            callback([], "Erreur lors de l'exécution de la requête :");
        } else {
            console.error("Callback is not a function");
        }
    }
}
function ExecuteQuerySitePromise(pool, param, type) {
    return new Promise((resolve, reject) => {
        ExecuteQuerySite(pool, param, type, (rows, msg) => {
            if (msg && msg.startsWith("Erreur")) {
                return reject(new Error(msg));
            }
            resolve({ rows, message: msg });
        });
    });
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
        whereFilters.push({
            milieux_naturels: decodeURIComponent(params.milnat),
        });
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

    if (ResultValues.length === 0)
        selectors.push({ name: property, values: [] });
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

/**
 * Fonction pour mettre à jour les informations d'un espace et d'un site d'un seul coup.
 * @param {*} pool La connexion à la base de données
 * @param {*} res La réponse HTTP
 * @param {*} espaceQuery La requête pour mettre à jour l'espace
 * @param {*} siteQuery La requête pour mettre à jour le site
 */
async function updateEspaceSite(pool, res, espaceQuery, siteQuery) {
    // console.log(espaceQuery);
    // console.log(siteQuery);

    // Exécuter les requêtes UPDATE
    ExecuteQuerySite(
        pool,
        { query: espaceQuery, message: "espace/put/table=espace_site/uuid" },
        "update",
        (resultats, message) => {
            console.log(
                "resultats suite à la requete table espaces : " + resultats
            );
            // if (resultats !== false) {
            if (message === "ok") {
                console.log("DEBUG PUT ESTPACE OK");
                ExecuteQuerySite(
                    pool,
                    {
                        query: siteQuery,
                        message: "site/put/table=espace_site/uuid",
                    },
                    "update",
                    (resultats, message) => {
                        res.setHeader("Access-Control-Allow-Origin", "*");
                        res.setHeader(
                            "Content-Type",
                            "application/json; charset=utf-8"
                        );

                        if (message === "ok") {
                            res.status(200).json({
                                success: true,
                                message: "Mise à jour réussie.",
                                code: 0,
                                data: resultats,
                            });
                            console.log("message : " + message);
                            console.log("resultats : " + resultats);
                        } else {
                            const currentDateTime = new Date().toISOString();
                            console.log(
                                `Échec de la requête de la table sites à ${currentDateTime}`
                            );
                            console.log(siteQuery.text);
                            console.log(siteQuery.values);
                            res.status(500).json({
                                success: false,
                                message:
                                    "Erreur, la requête s'est mal exécutée.",
                                code: 1,
                            });
                        }
                    }
                );
            } else {
                console.log("DEBUG PUT ESPACE FAIL");
                console.log("message : " + message);

                const currentDateTime = new Date().toISOString();
                console.log(
                    `Échec de la requête de la table espaces à ${currentDateTime}`
                );
                console.log(espaceQuery.text);
                console.log(espaceQuery.values);
                res.status(500).json({
                    success: false,
                    message: "Erreur, la requête s'est mal exécutée.",
                });
            }
        }
    );
}

function executeQueryAndRespond(
    pool,
    SelectFields,
    FromTable,
    where,
    uuid,
    res,
    message,
    mode = "lite"
) {
    const queryObject = {
        text: joinQuery(SelectFields, FromTable, where),
        // values: [uuid],
    };
    if (Array.isArray(uuid)) {
        queryObject.values = uuid;
    } else if (uuid !== null) {
        queryObject.values = [uuid];
    } // Ajoutes les valeurs si elles existent a l'objet queryObject

    console.log("queryObject : ");
    console.log(queryObject);

    ExecuteQuerySite(
        pool,
        { query: queryObject, message: message },
        "select",
        (resultats) => {
            let json;
            if (resultats.length > 0) {
                json = JSON.stringify(resultats);
                if (mode == "full" && message !== "docs/id/full") {
                    json = json.slice(1, -1);
                }
            } else {
                json = JSON.stringify([]);
            }
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            console.log("json : " + json);
            res.end(json);
        }
    );
}

function reset() {
    // Variables vides pour les requêtes

    let SelectFields;
    let FromTable;
    let where;
    let message;
    let json;

    return { SelectFields, FromTable, where, message, json };
}

function convertToWKT_origonal(coordinates) {
    console.log("Coordonnées brutes:", coordinates);

    const processPolygon = (polygon) => {
        // Supprimer les doublons consécutifs
        const uniqueCoords = polygon.filter(
            (coord, index, self) =>
                index ===
                self.findIndex((c) => c[0] === coord[0] && c[1] === coord[1])
        );

        // Ajouter le point de fermeture si nécessaire (premier point = dernier point)
        if (
            uniqueCoords[0][0] !== uniqueCoords[uniqueCoords.length - 1][0] ||
            uniqueCoords[0][1] !== uniqueCoords[uniqueCoords.length - 1][1]
        ) {
            uniqueCoords.push(uniqueCoords[0]);
        }

        // Convertir les coordonnées en WKT
        return uniqueCoords
            .map((coord) => `${coord[0]} ${coord[1]}`)
            .join(", ");
    };

    let wktCoords;
    let type;

    if (coordinates.length > 1) {
        // Multipolygon
        type = "MULTIPOLYGON";
        wktCoords = coordinates
            .map(
                (polygon) =>
                    `(${polygon
                        .map((ring) => `(${processPolygon(ring)})`)
                        .join(",")})`
            )
            .join(",");
    } else {
        // Simple polygon
        type = "POLYGON";
        wktCoords = coordinates
            .map((ring) => `(${processPolygon(ring)})`)
            .join(",");
    }

    const EWKT = `SRID=2154;${type}(${wktCoords})`;
    console.log(EWKT);
    return EWKT;
}

/**
 * Détecte le type de géométrie d'un shapefile (POINT, LINESTRING, POLYGON, MULTIPOLYGON, etc.)
 * @param {string} shpPath - Chemin vers le fichier .shp
 * @param {string} dbfPath - Chemin vers le fichier .dbf
 * @returns {Promise<string>} - Le type de géométrie détecté (ex: 'Point', 'Polygon', ...)
 */
async function detectShapefileGeometryType(shpPath, dbfPath) {
    try {
        const source = await shapefile.open(shpPath, dbfPath);
        const result = await source.read();
        if (result.done) {
            throw new Error("Aucune géométrie trouvée dans le shapefile");
        }
        // Le type est dans result.value.geometry.type (ex: 'Point', 'Polygon', ...)
        return result.value.geometry.type.toUpperCase();
    } catch (error) {
        console.error(
            "Erreur lors de la détection du type de géométrie :",
            error
        );
        throw error;
    }
}

function convertToWKT(coordinates, typeGeometry = null) {
    console.log("Coordonnées brutes:", coordinates);

    // Si le type est explicitement passé, on l'utilise, sinon on déduit
    let type = typeGeometry ? typeGeometry.toUpperCase() : null;

    // Détection automatique si type non fourni
    // if (!type) {
    if (1) {
        if (typeof coordinates[0] === "number") {
            type = "POINT";
        } else if (
            Array.isArray(coordinates[0]) &&
            typeof coordinates[0][0] === "number"
        ) {
            type = "LINESTRING";
        } else if (
            Array.isArray(coordinates[0]) &&
            Array.isArray(coordinates[0][0])
        ) {
            // Polygon ou MultiPolygon
            type = coordinates.length > 1 ? "MULTIPOLYGON" : "POLYGON";
        }
    }

    if (type === "POINT") {
        // [x, y]
        wktCoords = `${coordinates[0]} ${coordinates[1]}`;
    } else if (type === "LINESTRING") {
        wktCoords = coordinates
            .map((coord) => `${coord[0]} ${coord[1]}`)
            .join(", ");
    } else if (type === "POLYGON") {
        const processPolygon = (polygon) => {
            const uniqueCoords = polygon.filter(
                (coord, index, self) =>
                    index ===
                    self.findIndex(
                        (c) => c[0] === coord[0] && c[1] === coord[1]
                    )
            );
            if (
                uniqueCoords[0][0] !==
                    uniqueCoords[uniqueCoords.length - 1][0] ||
                uniqueCoords[0][1] !== uniqueCoords[uniqueCoords.length - 1][1]
            ) {
                uniqueCoords.push(uniqueCoords[0]);
            }
            return uniqueCoords
                .map((coord) => `${coord[0]} ${coord[1]}`)
                .join(", ");
        };
        wktCoords = coordinates
            .map((ring) => `(${processPolygon(ring)})`)
            .join(",");
    } else if (type === "MULTIPOLYGON") {
        const processPolygon = (polygon) => {
            const uniqueCoords = polygon.filter(
                (coord, index, self) =>
                    index ===
                    self.findIndex(
                        (c) => c[0] === coord[0] && c[1] === coord[1]
                    )
            );
            if (
                uniqueCoords[0][0] !==
                    uniqueCoords[uniqueCoords.length - 1][0] ||
                uniqueCoords[0][1] !== uniqueCoords[uniqueCoords.length - 1][1]
            ) {
                uniqueCoords.push(uniqueCoords[0]);
            }
            return uniqueCoords
                .map((coord) => `${coord[0]} ${coord[1]}`)
                .join(", ");
        };
        wktCoords = coordinates
            .map(
                (polygon) =>
                    `(${polygon
                        .map((ring) => `(${processPolygon(ring)})`)
                        .join(",")})`
            )
            .join(",");
    } else {
        throw new Error("Type de géométrie non supporté");
    }

    const EWKT = `SRID=2154;${type}(${wktCoords})`;
    console.log(EWKT);
    return { type: type, EWKT: EWKT };
}

const unzipper = require("unzipper");
const fs = require("fs");
const path = require("path");

async function extractZipFile(filePath, extractPath) {
    // Retourne true si le shapefile extrait est un dossier
    // Retourne false si les fichiers du shapefile ont été zippé comme ça
    let folderToReturn = "";
    folderToReturn = await new Promise((resolve, reject) => {
        // Cette promise retourne sa valeur isFolder au travers de resolve
        fs.createReadStream(filePath)
            .pipe(unzipper.Parse())
            .on("entry", async (entry) => {
                const cheminElement = entry.path;
                // console.log('cheminElement:', cheminElement);
                const name = path.basename(cheminElement); // Nom d'un dossier à retourner

                const type = entry.type;
                const fullPath = path.join(extractPath, cheminElement);

                if (
                    cheminElement.startsWith("__MACOSX") ||
                    cheminElement.startsWith(".DS_Store") ||
                    cheminElement.startsWith("._")
                ) {
                    entry.autodrain();
                } else {
                    if (type === "Directory") {
                        folderToReturn = name;
                        await fs.promises.mkdir(fullPath, { recursive: true });
                    } else {
                        entry.pipe(fs.createWriteStream(fullPath));
                    }
                }
            })
            .on("close", async () => {
                try {
                    console.log("Fichier extrait à supprimer :", filePath);
                    await fs.promises.rm(filePath, { force: true });
                    resolve(folderToReturn); // Résoudre la promesse avec isFolder
                } catch (error) {
                    reject(error);
                }
            })
            .on("error", reject);
    });
    return folderToReturn;
}

const http = require("http");
const { isArray } = require("util");
const https = require('https');

async function getBilan(uuid) {
    console.log("getBilan() : uuid = " + uuid);

    const projet = await getData("projet", uuid);
    const site = await getData("site", projet.site);
    const communes = await getData("commune", projet.site);
    const objectifs = await getData("objectif", uuid);
    const operations = await getData("operation", uuid);
    const operations_full = {};
    for (let op of operations) {
        operations_full[op.uuid_ope] = await getData(
            "operation_full",
            op.uuid_ope
        );
    }

    return { projet, site, communes, objectifs, operations, operations_full };
}

function getData(type, uuid, hostname, port = process.env.NODE_PORT) {
    // ... retourne une Promise qui résout le site
    return new Promise((resolve, reject) => {
        const isProduction = process.env.NODE_ENV === 'production';
        if (isProduction) {
        hostname = 'si-10.cen-champagne-ardenne.org';
        port = 8889; // Le port exposé en prod
    } else {
        hostname = hostname || 'localhost';
        port = port || process.env.NODE_PORT;
    }
        const protocol = isProduction ? https : http;
        let path = '';

        if (!type || !uuid) {
            return reject(new Error("Type et uuid sont requis"));
        } else if (type === "projet") {
            path =
                "/sites/projets/uuid=" + uuid + "/full?type=gestion&webapp=1";
        } else if (type === "site") {
            path = "/sites/uuid=" + uuid;
        } else if (type === "objectif") {
            path = "/sites/objectifs/uuid=" + uuid + "/lite";
        } else if (type === "operation") {
            path = "/sites/operations/uuid=" + uuid + "/lite";
        } else if (type === "operation_full") {
            path = "/sites/operations/uuid=" + uuid + "/full?webapp=1";
        } else if (type === "commune") {
            path = "/sites/commune/uuid=" + uuid;
        }

        const options = {
            hostname,
            port,
            path,
            method: "GET",
            headers: { "Content-Type": "application/json" },
        };

        const httpReq = protocol.request(options, (httpRes) => {
            let data = '';
            httpRes.on('data', (chunk) => { data += chunk; });
            httpRes.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
            httpRes.on("error", reject);
        });

        // Ajout du timeout (exemple 5000 ms)
        httpReq.setTimeout(5000, () => {
            httpReq.abort();
            reject(new Error(`Timeout lors de la récupération de ${type}`));
        });

        httpReq.on("error", reject);
        httpReq.end();
    });
}

module.exports = {
    joinQuery,
    ExecuteQuerySite,
    ExecuteQuerySitePromise,
    selectQuery,
    distinctSiteResearch,
    updateEspaceSite,
    executeQueryAndRespond,
    reset,
    detectShapefileGeometryType,
    convertToWKT,
    extractZipFile, // Ajouter l'export de la nouvelle fonction
    getBilan,
};
