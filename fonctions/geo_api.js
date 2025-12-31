const https = require('https');
const http = require('http');

// Charger les variables d'environnement
require('dotenv').config();

// Configuration Lizmap depuis les variables d'environnement
const LIZMAP_USER = process.env.LIZMAP_USER;
const LIZMAP_PASSWORD = process.env.LIZMAP_PASSWORD;

const LIZMAP_BASE_URL = 'https://cenca.lizmap.com/maps/index.php/lizmap/service';

/**
 * Récupère la liste des communes pour les départements spécifiés depuis l'API geo.api.gouv.fr
 * @param {Array<string>} departements - Liste des codes de départements (ex: ['08', '10', '51', '52'])
 * @param {Object} options - Options de configuration
 * @param {boolean} options.includePopulation - Inclure la population dans les résultats
 * @param {boolean} options.includeCodesPostaux - Inclure les codes postaux dans les résultats
 * @returns {Promise<Array>} - Liste des communes avec nom, code INSEE, et éventuellement population/codes postaux
 */
async function getCommunesByDepartements(departements = ['08', '10', '51', '52'], options = {}) {
    return new Promise((resolve, reject) => {
        try {
            // Construction des champs à récupérer
            let fields = ['nom', 'code'];
            if (options.includePopulation) fields.push('population');
            if (options.includeCodesPostaux) fields.push('codesPostaux');
            
            // Construction de l'URL avec les départements
            const departementsStr = departements.join(',');
            const fieldsStr = fields.join(',');
            const url = `https://geo.api.gouv.fr/communes?codeDepartement=${departementsStr}&fields=${fieldsStr}&format=json`;
            
            // console.log(`[API_IGN] Récupération des communes pour les départements: ${departementsStr}`);
            // console.log(`[API_IGN] URL: ${url}`);
            
            const request = https.get(url, (response) => {
                let data = '';
                
                response.on('data', (chunk) => {
                    data += chunk;
                });
                
                response.on('end', () => {
                    try {
                        const communes = JSON.parse(data);
                        
                        if (Array.isArray(communes)) {
                            // console.log(`[API_IGN] ${communes.length} communes récupérées avec succès`);
                            
                            // Tri par nom de commune
                            communes.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
                            
                            resolve(communes);
                        } else {
                            console.error('[API_IGN] Réponse inattendue de l\'API:', communes);
                            reject(new Error('Format de réponse inattendu de l\'API geo.api.gouv.fr'));
                        }
                    } catch (parseError) {
                        console.error('[API_IGN] Erreur lors du parsing JSON:', parseError);
                        reject(new Error(`Erreur lors du parsing de la réponse: ${parseError.message}`));
                    }
                });
            });
            
            request.on('error', (error) => {
                console.error('[API_IGN] Erreur lors de la requête vers geo.api.gouv.fr:', error);
                reject(new Error(`Erreur réseau: ${error.message}`));
            });
            
            // Timeout de 10 secondes
            request.setTimeout(10000, () => {
                request.abort();
                reject(new Error('Timeout lors de la récupération des communes'));
            });
            
        } catch (error) {
            console.error('[API_IGN] Erreur dans getCommunesByDepartements:', error);
            reject(error);
        }
    });
}

// /**
//  * Récupère la liste des communes pour un département donné via l'API geo.api.gouv.fr
//  * @param {number|string} departement - Code du département (ex: 10, 51, 52)
//  * @returns {Promise<Array>} - Liste des communes avec nom et code INSEE
//  */
// async function getCommune(departement) {
//     return new Promise((resolve, reject) => {
//         try {
//             // S'assure que le code département est une chaîne de 2 chiffres
//             const depStr = String(departement).padStart(2, '0');
//             const url = `https://geo.api.gouv.fr/communes?codeDepartement=${depStr}&fields=nom,code&format=json`;
//             console.log(`[API_IGN] Récupération des communes pour le département: ${depStr}`);
//             console.log(`[API_IGN] URL: ${url}`);
//             const request = require('https').get(url, (response) => {
//                 let data = '';
//                 response.on('data', (chunk) => { data += chunk; });
//                 response.on('end', () => {
//                     try {
//                         const communes = JSON.parse(data);
//                         if (Array.isArray(communes)) {
//                             // Tri par nom de commune
//                             communes.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
//                             resolve(communes);
//                         } else {
//                             console.error('[API_IGN] Réponse inattendue de l\'API:', communes);
//                             reject(new Error('Format de réponse inattendu de l\'API geo.api.gouv.fr'));
//                         }
//                     } catch (parseError) {
//                         console.error('[API_IGN] Erreur lors du parsing JSON:', parseError);
//                         reject(new Error(`Erreur lors du parsing de la réponse: ${parseError.message}`));
//                     }
//                 });
//             });
//             request.on('error', (error) => {
//                 console.error('[API_IGN] Erreur lors de la requête vers geo.api.gouv.fr:', error);
//                 reject(new Error(`Erreur réseau: ${error.message}`));
//             });
//             // Timeout de 10 secondes
//             request.setTimeout(10000, () => {
//                 request.abort();
//                 reject(new Error('Timeout lors de la récupération des communes'));
//             });
//         } catch (error) {
//             console.error('[API_IGN] Erreur dans getCommune:', error);
//             reject(error);
//         }
//     });
// }

/**
 * Récupère les parcelles cadastrales via le service WFS de l'IGN dans une bounding box
 * @param {Object} bbox - Bounding box avec les coordonnées
 * @param {number} bbox.minX - Longitude minimale
 * @param {number} bbox.minY - Latitude minimale  
 * @param {number} bbox.maxX - Longitude maximale
 * @param {number} bbox.maxY - Latitude maximale
 * @param {Object} options - Options de configuration
 * @param {string} options.srs - Système de coordonnées (défaut: 'EPSG:4326')
 * @param {number} options.maxFeatures - Nombre maximum de parcelles à retourner (défaut: 1000)
 * @param {Array<string>} options.propertyNames - Propriétés à récupérer (défaut: toutes)
 * @returns {Promise<Object>} - GeoJSON FeatureCollection des parcelles
 */
async function getParcellesCadastrales(bbox, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            const {
                srs = 'EPSG:4326',
                maxFeatures = 1000,
                propertyNames = []
            } = options;
            
            // Validation de la bbox
            if (!bbox || typeof bbox.minX === 'undefined' || typeof bbox.minY === 'undefined' || 
                typeof bbox.maxX === 'undefined' || typeof bbox.maxY === 'undefined') {
                return reject(new Error('Bounding box invalide. Format requis: {minX, minY, maxX, maxY}'));
            }
            
            // Construction des paramètres WFS avec le nouveau serveur Géoportail France
            const params = new URLSearchParams({
                'SERVICE': 'WFS',
                'VERSION': '2.0.0',
                'REQUEST': 'GetFeature',
                'TYPENAME': 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle',
                'OUTPUTFORMAT': 'application/json',
                'SRSNAME': srs,
                'BBOX': `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY},${srs}`,
                'MAXFEATURES': maxFeatures.toString()
            });
            
            // Ajout des propriétés spécifiques si demandées
            if (propertyNames.length > 0) {
                params.append('PROPERTYNAME', propertyNames.join(','));
            }
            
            const url = `https://data.geopf.fr/wfs/ows?${params.toString()}`;
            
            console.log(`[API_IGN] Récupération des parcelles cadastrales dans la bbox: ${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY}`);
            console.log(`[API_IGN] URL WFS (Géoportail France): ${url}`);
            
            const request = https.get(url, (response) => {
                let data = '';
                
                response.on('data', (chunk) => {
                    data += chunk;
                });
                
                response.on('end', () => {
                    try {
                        const geoJson = JSON.parse(data);
                        
                        // Vérification si la réponse est un GeoJSON valide
                        if (geoJson.type === 'FeatureCollection') {
                            console.log(`[API_IGN] ${geoJson.features.length} parcelles reçues du serveur WFS`);
                            
                            // Appliquer la limitation demandée par l'utilisateur côté application
                            if (geoJson.features.length > maxFeatures) {
                                geoJson.features = geoJson.features.slice(0, maxFeatures);
                                console.log(`[API_IGN] Limitation à ${maxFeatures} parcelles appliquée côté client`);
                            }
                            
                            console.log(`[API_IGN] ${geoJson.features.length} parcelles retournées avec succès`);
                            resolve(geoJson);
                        } else if (geoJson.type === 'ExceptionReport') {
                            // Gestion des erreurs WFS
                            const errorMsg = geoJson.Exception?.ExceptionText || 'Erreur WFS inconnue';
                            console.error('[API_IGN] Erreur WFS:', errorMsg);
                            reject(new Error(`Erreur WFS: ${errorMsg}`));
                        } else {
                            console.error('[API_IGN] Réponse WFS inattendue:', geoJson);
                            reject(new Error('Format de réponse WFS inattendu'));
                        }
                    } catch (parseError) {
                        console.error('[API_IGN] Erreur lors du parsing JSON WFS:', parseError);
                        console.error('[API_IGN] Données reçues (extrait):', data.substring(0, 500));
                        reject(new Error(`Erreur lors du parsing de la réponse WFS: ${parseError.message}`));
                    }
                });
            });
            
            request.on('error', (error) => {
                console.error('[API_IGN] Erreur lors de la requête WFS:', error);
                reject(new Error(`Erreur réseau WFS: ${error.message}`));
            });
            
            // Timeout de 15 secondes pour les requêtes WFS (plus longues)
            request.setTimeout(15000, () => {
                request.abort();
                reject(new Error('Timeout lors de la récupération des parcelles cadastrales'));
            });
            
        } catch (error) {
            console.error('[API_IGN] Erreur dans getParcellesCadastrales:', error);
            reject(error);
        }
    });
}

/**
 * Récupère les parcelles cadastrales pour une commune spécifique via son code INSEE
 * Utilise d'abord l'API geo.api.gouv.fr pour obtenir les limites de la commune,
 * puis interroge le WFS avec cette bounding box
 * @param {string} codeInsee - Code INSEE de la commune
 * @param {Object} options - Options de configuration
 * @param {number} options.maxFeatures - Nombre maximum de parcelles à retourner (défaut: 5000)
 * @param {string} options.srs - Système de coordonnées (défaut: 'EPSG:4326')
 * @returns {Promise<Object>} - GeoJSON FeatureCollection des parcelles de la commune
 */
async function getParcellesByCommune(codeInsee, options = {}) {
    return new Promise(async (resolve, reject) => {
        try {
            const {
                maxFeatures = 5000,
                srs = 'EPSG:4326'
            } = options;
            
            if (!codeInsee || typeof codeInsee !== 'string') {
                return reject(new Error('Code INSEE invalide'));
            }
            
            console.log(`[API_IGN] Récupération des limites de la commune ${codeInsee} via geo.api.gouv.fr`);
            
            // Étape 1: Récupérer les limites géographiques de la commune
            const communeUrl = `https://geo.api.gouv.fr/communes/${codeInsee}?fields=centre,contour&format=json`;
            
            const communeRequest = https.get(communeUrl, (communeResponse) => {
                let communeData = '';
                
                communeResponse.on('data', (chunk) => {
                    communeData += chunk;
                });
                
                communeResponse.on('end', async () => {
                    try {
                        const commune = JSON.parse(communeData);
                        
                        if (!commune.contour) {
                            return reject(new Error(`Impossible de récupérer les limites de la commune ${codeInsee}`));
                        }
                        
                        // Calculer la bounding box à partir du contour de la commune
                        const coordinates = commune.contour.coordinates[0]; // Premier polygon
                        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                        
                        coordinates.forEach(coord => {
                            const [x, y] = coord;
                            minX = Math.min(minX, x);
                            minY = Math.min(minY, y);
                            maxX = Math.max(maxX, x);
                            maxY = Math.max(maxY, y);
                        });
                        
                        const bbox = { minX, minY, maxX, maxY };
                        console.log(`[API_IGN] Bbox calculée pour ${codeInsee}:`, bbox);
                        
                        // Étape 2: Utiliser la fonction existante getParcellesCadastrales avec cette bbox
                        // On demande plus de parcelles que nécessaire au WFS pour pouvoir filtrer et limiter ensuite
                        try {
                            const parcelles = await getParcellesCadastrales(bbox, { 
                                maxFeatures: Math.max(maxFeatures * 3, 1000), // On demande 3x plus pour avoir une marge après filtrage
                                srs 
                            });
                            
                            // Filtrer les parcelles pour ne garder que celles de la commune demandée
                            // (au cas où la bbox inclurait des parcelles d'autres communes limitrophes)
                            let parcellesFiltrees = parcelles.features.filter(feature => {
                                // Vérifier si la parcelle a une propriété insee_com
                                return !feature.properties.insee_com || feature.properties.insee_com === codeInsee;
                            });
                            
                            // Appliquer la limitation demandée par l'utilisateur
                            if (parcellesFiltrees.length > maxFeatures) {
                                parcellesFiltrees = parcellesFiltrees.slice(0, maxFeatures);
                                console.log(`[API_IGN] Limitation à ${maxFeatures} parcelles appliquée`);
                            }
                            
                            const resultat = {
                                ...parcelles,
                                features: parcellesFiltrees
                            };
                            
                            console.log(`[API_IGN] ${parcelles.features.length} parcelles trouvées dans la bbox, ${parcellesFiltrees.length} retournées pour la commune ${codeInsee}`);
                            resolve(resultat);
                            
                        } catch (wfsError) {
                            reject(new Error(`Erreur lors de la récupération des parcelles WFS: ${wfsError.message}`));
                        }
                        
                    } catch (parseError) {
                        console.error('[API_IGN] Erreur lors du parsing des données de la commune:', parseError);
                        reject(new Error(`Erreur lors du parsing des données de la commune: ${parseError.message}`));
                    }
                });
            });
            
            communeRequest.on('error', (error) => {
                console.error('[API_IGN] Erreur lors de la récupération des limites de la commune:', error);
                reject(new Error(`Erreur réseau lors de la récupération des limites: ${error.message}`));
            });
            
            // Timeout pour la récupération des limites de la commune
            communeRequest.setTimeout(10000, () => {
                communeRequest.abort();
                reject(new Error('Timeout lors de la récupération des limites de la commune'));
            });
            
        } catch (error) {
            console.error('[API_IGN] Erreur dans getParcellesByCommune:', error);
            reject(error);
        }
    });
}

/**
 * Parse un identifiant de parcelle (idu) flexible en ses composants
 * @param {string} idu - Identifiant de parcelle (idu/code_parcelle)
 */
function parseIduFlexible(idu) {
    // idu = [code_insee][préfixe][section][numero]
    // code_insee : 5 chiffres
    // préfixe : 3 ou 4 chiffres (souvent, mais variable)
    // section : 1 ou 2 lettres
    // numero : 3 ou 4 chiffres (à compléter à gauche si besoin)
    const iduStr = typeof idu === 'string' ? idu.trim() : String(idu);

    // code_insee = 5 premiers caractères
    const code_insee = iduStr.substring(0, 5);

    // On cherche la section (lettres) et le numéro (chiffres) à la fin
    // On part du principe que le numéro est toujours à la fin
    const match = iduStr.match(/^(\d{5})(\d+)([A-Z]{1,2})(\d{3,4})$/i);
    if (!match) {
        console.warn(`[parseIduFlexible] Format idu inattendu : ${iduStr}`);
        return null;
    }
    // match[1] = code_insee, match[2] = préfixe, match[3] = section, match[4] = numero
    let section;
    if (match[3].length === 2) {
        section = match[3];
    } else if (match[3].length === 1) {
        section = '0' + match[3];
    }
    let numero = match[4];
    // Compléter le numéro à gauche si < 4 chiffres
    if (numero.length < 4) {
        numero = numero.padStart(4, '0');
    }
    return { code_insee, section, numero };
}

/**
 * Récupère les infos principales pour une liste de parcelles (idu/code_parcelle)
 * Pour chaque idu, retourne : nom de la commune, surface, section, numéro, bbox
 * @param {Array<string>} idus - Tableau des identifiants de parcelle (idu/code_parcelle)
 * @param {Object} options - Options de configuration (srs, etc)
 * @returns {Promise<Array<Object>>} - Tableau d'objets { idu, nom_com, contenance, section, numero, bbox }
 */
async function getInfosParcellesByIdus(idus = [], options = {}) {
    if (!Array.isArray(idus) || idus.length === 0) {
        throw new Error('La liste des idu (code_parcelle) est vide ou invalide');
    }
    
    const results = [];
    for (const idu of idus) {
        const { code_insee, section, numero } = parseIduFlexible(idu);
        const url = `https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=${encodeURIComponent(code_insee)}&section=${encodeURIComponent(section)}&numero=${encodeURIComponent(numero)}`;
        console.log(`[API_CARTO_IGN] Requête API Carto REST pour idu: ${idu}`);
        console.log(`[API_CARTO_IGN] URL: ${url}`);
        // eslint-disable-next-line no-await-in-loop
        const info = await new Promise((resolve) => {
            https.get(url, (response) => {
                let data = '';
                response.on('data', (chunk) => { data += chunk; });
                response.on('end', () => {
                    const contentType = response.headers['content-type'] || '';
                    if (contentType.includes('text/html')) {
                        console.warn(`[API_CARTO_IGN] Réponse HTML reçue pour idu ${idu} (probablement non trouvé)`);
                        return resolve(null);
                    }
                    try {
                        const obj = JSON.parse(data);
                        if (!obj || obj.type !== 'FeatureCollection' || !Array.isArray(obj.features) || obj.features.length === 0) {
                            return resolve(null);
                        }
                        const feature = obj.features[0];
                        const props = feature.properties || {};
                        let bboxStr = null;
                        let coords = null;
                        if (feature.geometry && feature.geometry.type === 'Polygon') {
                            coords = feature.geometry.coordinates[0];
                        } else if (feature.geometry && feature.geometry.type === 'MultiPolygon') {
                            coords = feature.geometry.coordinates[0][0];
                        }
                        if (coords) {
                            let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
                            coords.forEach(([x, y]) => {
                                xmin = Math.min(xmin, x);
                                ymin = Math.min(ymin, y);
                                xmax = Math.max(xmax, x);
                                ymax = Math.max(ymax, y);
                            });
                            bboxStr = `${xmin},${ymin},${xmax},${ymax}`;
                        }
                        resolve({
                            idu: props.idu || props.code_parcelle,
                            nom_com: props.nom_com || props.nom_commune,
                            contenance: props.contenance,
                            section: props.section,
                            numero: props.numero,
                            bbox: bboxStr
                        });
                    } catch (err) {
                        console.warn(`[API_CARTO_IGN] Erreur de parsing JSON pour idu ${idu}`);
                        resolve(null);
                    }
                });
            }).on('error', () => {
                console.warn(`[API_CARTO_IGN] Erreur réseau pour idu ${idu}`);
                resolve(null);
            });
        });
        if (info) results.push(info);
    }
    return results;
}

/**
 * Fonction utilitaire pour convertir une bounding box de string vers objet
 * @param {string} bboxString - Bounding box au format "minX,minY,maxX,maxY"
 * @returns {Object} - Objet bbox avec propriétés minX, minY, maxX, maxY
 */
function parseBboxString(bboxString) {
    try {
        const coords = bboxString.split(',').map(Number);
        if (coords.length !== 4 || coords.some(isNaN)) {
            throw new Error('Format de bbox invalide');
        }
        
        return {
            minX: coords[0],
            minY: coords[1],
            maxX: coords[2],
            maxY: coords[3]
        };
    } catch (error) {
        throw new Error(`Erreur lors du parsing de la bbox: ${error.message}`);
    }
}

/**
 * Fonction utilitaire pour valider et ajuster une bounding box
 * @param {Object} bbox - Bounding box à valider
 * @param {number} maxArea - Aire maximale autorisée (en degrés carrés, défaut: 0.1)
 * @returns {Object} - Bounding box validée et éventuellement ajustée
 */
function validateAndAdjustBbox(bbox, maxArea = 0.1) {
    const { minX, minY, maxX, maxY } = bbox;
    
    // Vérification de la cohérence
    if (minX >= maxX || minY >= maxY) {
        throw new Error('Bounding box invalide: les coordonnées minimales doivent être inférieures aux maximales');
    }
    
    // Calcul de l'aire
    const area = (maxX - minX) * (maxY - minY);
    
    if (area > maxArea) {
        console.warn(`[API_IGN] Bounding box trop grande (${area.toFixed(6)}), limitation à ${maxArea}`);
        
        // Réduction proportionnelle en gardant le centre
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const scale = Math.sqrt(maxArea / area);
        const halfWidth = (maxX - minX) * scale / 2;
        const halfHeight = (maxY - minY) * scale / 2;
        
        return {
            minX: centerX - halfWidth,
            minY: centerY - halfHeight,
            maxX: centerX + halfWidth,
            maxY: centerY + halfHeight
        };
    }
    
    return bbox;
}

/**
 * Récupère les données depuis Lizmap avec authentification
 * @param {Object} params - Paramètres de la requête WFS
 * @param {string} params.repository - Nom du dépôt Lizmap (ex: 'cenca')
 * @param {string} params.project - Nom du projet (ex: 'IRENEE')
 * @param {string} params.version - Version WFS (défaut: '1.1.0')
 * @param {string} params.request - Type de requête WFS (défaut: 'GetFeature')
 * @param {Object} options - Options supplémentaires
 * @param {string} options.typename - Nom de la couche à interroger
 * @param {string} options.outputFormat - Format de sortie (défaut: 'application/json')
 * @param {number} options.maxFeatures - Nombre maximum d'entités (défaut: 1000)
 * @param {string} options.bbox - Bounding box optionnelle
 * @returns {Promise<Object>} - Données géographiques depuis Lizmap
 */
async function getLizmapData(params, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            if (!LIZMAP_USER || !LIZMAP_PASSWORD) {
                return reject(new Error('Variables d\'environnement LIZMAP_USER et LIZMAP_PASSWORD requises'));
            }

            const {
                repository = 'cenca',
                project = 'IRENEE', 
                version = '1.1.0',
                request = 'GetFeature'
            } = params;

            const {
                typename,
                outputFormat = 'application/json',
                maxFeatures = 1000,
                bbox
            } = options;

            // Construction des paramètres WFS pour Lizmap
            const wfsParams = new URLSearchParams({
                'repository': repository,
                'project': project,
                'SERVICE': 'WFS',
                'VERSION': version,
                'REQUEST': request,
                'OUTPUTFORMAT': outputFormat,
                'MAXFEATURES': maxFeatures.toString()
            });

            // Ajout du nom de la couche si spécifié
            if (typename) {
                wfsParams.append('TYPENAME', typename);
            }

            // Ajout de la bbox si spécifiée
            if (bbox) {
                wfsParams.append('BBOX', bbox);
            }

            const url = `${LIZMAP_BASE_URL}?${wfsParams.toString()}`;
            
            console.log(`[LIZMAP] Récupération des données depuis ${repository}/${project}`);
            console.log(`[LIZMAP] URL: ${url}`);

            // Création de l'authentification Basic
            const auth = Buffer.from(`${LIZMAP_USER}:${LIZMAP_PASSWORD}`).toString('base64');

            const request_options = {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'User-Agent': 'NodeJS-GeoAPI/1.0'
                }
            };

            const request_obj = https.get(url, request_options, (response) => {
                let data = '';

                response.on('data', (chunk) => {
                    data += chunk;
                });

                response.on('end', () => {
                    try {
                        // Tentative de parsing JSON
                        const jsonData = JSON.parse(data);
                        
                        if (jsonData.type === 'FeatureCollection') {
                            console.log(`[LIZMAP] ${jsonData.features.length} entités récupérées avec succès`);
                            resolve(jsonData);
                        } else if (jsonData.type === 'ExceptionReport') {
                            const errorMsg = jsonData.Exception?.ExceptionText || 'Erreur WFS Lizmap inconnue';
                            console.error('[LIZMAP] Erreur WFS:', errorMsg);
                            reject(new Error(`Erreur WFS Lizmap: ${errorMsg}`));
                        } else {
                            console.log(`[LIZMAP] Données récupérées:`, jsonData);
                            resolve(jsonData);
                        }
                    } catch (parseError) {
                        // Si ce n'est pas du JSON, on retourne les données brutes
                        console.log('[LIZMAP] Réponse non-JSON reçue, retour des données brutes');
                        console.log('[LIZMAP] Extrait de la réponse:', data.substring(0, 300));
                        
                        // Vérifier si c'est du XML d'erreur
                        if (data.includes('ExceptionReport') || data.includes('ServiceException')) {
                            reject(new Error(`Erreur Lizmap: ${data.substring(0, 500)}`));
                        } else {
                            resolve({ data, contentType: response.headers['content-type'] });
                        }
                    }
                });
            });

            request_obj.on('error', (error) => {
                console.error('[LIZMAP] Erreur lors de la requête:', error);
                reject(new Error(`Erreur réseau Lizmap: ${error.message}`));
            });

            // Timeout de 20 secondes
            request_obj.setTimeout(20000, () => {
                request_obj.abort();
                reject(new Error('Timeout lors de la récupération des données Lizmap'));
            });

        } catch (error) {
            console.error('[LIZMAP] Erreur dans getLizmapData:', error);
            reject(error);
        }
    });
}

/**
 * Récupère les données d'une couche Lizmap avec filtrage par bbox et attributs
 * @param {Object} params - Paramètres de base
 * @param {string} params.repository - Nom du dépôt Lizmap (défaut: 'cenca')
 * @param {string} params.project - Nom du projet (défaut: 'IRENEE')
 * @param {string} params.layerName - Nom de la couche (ex: 'cenca_sites', 'cenca_autres')
 * @param {Object} options - Options de filtrage
 * @param {Object} options.bbox - Bounding box {minX, minY, maxX, maxY}
 * @param {string} options.codesite - Code site pour filtrer (optionnel)
 * @param {number} options.maxFeatures - Nombre maximum d'entités (défaut: 1000)
 * @param {string} options.srs - Système de coordonnées (défaut: 'EPSG:4326')
 * @returns {Promise<Object>} - GeoJSON FeatureCollection de la couche
 */
async function getLizmapLayerData(params, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            const {
                repository = 'cenca',
                project = 'IRENEE',
                layerName
            } = params;

            const {
                bbox,
                codesite,
                maxFeatures = 1000,
                srs = 'EPSG:4326'
            } = options;

            if (!layerName) {
                return reject(new Error('Nom de la couche (layerName) requis'));
            }

            // Construction des paramètres WFS pour Lizmap
            const wfsParams = new URLSearchParams({
                'repository': repository,
                'project': project,
                'SERVICE': 'WFS',
                'VERSION': '1.1.0',
                'REQUEST': 'GetFeature',
                'TYPENAME': layerName,
                'OUTPUTFORMAT': 'application/json',
                'SRSNAME': srs,
                'MAXFEATURES': maxFeatures.toString()
            });

            // Ajout de la bounding box si fournie
            if (bbox && bbox.minX !== undefined) {
                wfsParams.append('BBOX', `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY},${srs}`);
                console.log(`[LIZMAP] Bbox appliquée: ${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY}`);
            }

            // Ajout du filtre sur codesite si fourni
            if (codesite) {
                wfsParams.append('CQL_FILTER', `codesite='${codesite}'`);
                console.log(`[LIZMAP] Filtre codesite appliqué: ${codesite}`);
            }

            const url = `${LIZMAP_BASE_URL}?${wfsParams.toString()}`;
            
            console.log(`[LIZMAP] Récupération de la couche ${layerName} depuis ${repository}/${project}`);
            console.log(`[LIZMAP] URL: ${url}`);

            // Création de l'authentification Basic
            const auth = Buffer.from(`${LIZMAP_USER}:${LIZMAP_PASSWORD}`).toString('base64');

            const request_options = {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'User-Agent': 'NodeJS-GeoAPI/1.0'
                }
            };

            const request_obj = https.get(url, request_options, (response) => {
                let data = '';

                response.on('data', (chunk) => {
                    data += chunk;
                });

                response.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        
                        if (jsonData.type === 'FeatureCollection') {
                            console.log(`[LIZMAP] ${jsonData.features.length} entités récupérées pour la couche ${layerName}`);
                            
                            // Appliquer la limitation côté client si nécessaire
                            if (jsonData.features.length > maxFeatures) {
                                jsonData.features = jsonData.features.slice(0, maxFeatures);
                                console.log(`[LIZMAP] Limitation à ${maxFeatures} entités appliquée côté client`);
                            }
                            
                            resolve(jsonData);
                        } else if (jsonData.type === 'ExceptionReport') {
                            const errorMsg = jsonData.Exception?.ExceptionText || 'Erreur WFS Lizmap inconnue';
                            console.error('[LIZMAP] Erreur WFS:', errorMsg);
                            reject(new Error(`Erreur WFS Lizmap: ${errorMsg}`));
                        } else {
                            console.log(`[LIZMAP] Données non-GeoJSON récupérées:`, jsonData);
                            resolve(jsonData);
                        }
                    } catch (parseError) {
                        console.log('[LIZMAP] Réponse non-JSON reçue');
                        console.log('[LIZMAP] Extrait de la réponse:', data.substring(0, 300));
                        
                        // Vérifier si c'est une erreur XML
                        if (data.includes('ExceptionReport') || data.includes('ServiceException')) {
                            reject(new Error(`Erreur Lizmap: ${data.substring(0, 500)}`));
                        } else {
                            resolve({ 
                                data, 
                                contentType: response.headers['content-type'],
                                layer: layerName 
                            });
                        }
                    }
                });
            });

            request_obj.on('error', (error) => {
                console.error('[LIZMAP] Erreur lors de la requête:', error);
                reject(new Error(`Erreur réseau Lizmap: ${error.message}`));
            });

            // Timeout de 20 secondes
            request_obj.setTimeout(20000, () => {
                request_obj.abort();
                reject(new Error('Timeout lors de la récupération des données Lizmap'));
            });

        } catch (error) {
            console.error('[LIZMAP] Erreur dans getLizmapLayerData:', error);
            reject(error);
        }
    });
}

/**
 * Récupère les couches disponibles depuis un projet Lizmap
 * @param {string} repository - Nom du dépôt (défaut: 'cenca')
 * @param {string} project - Nom du projet (défaut: 'IRENEE')
 * @returns {Promise<Object>} - Capacités WFS du projet
 */
async function getLizmapCapabilities(repository = 'cenca', project = 'IRENEE') {
    return getLizmapData(
        { repository, project, request: 'GetCapabilities' },
        { outputFormat: 'text/xml' }
    );
}

/**
 * Fonction utilitaire pour créer une authentification Basic
 * @param {string} username - Nom d'utilisateur
 * @param {string} password - Mot de passe
 * @returns {string} - Header d'authentification Basic
 */
function createBasicAuth(username, password) {
    return Buffer.from(`${username}:${password}`).toString('base64');
}

/**
 * Récupère toutes les infos principales d'une commune à partir de son code INSEE
 * @param {string} codeInsee - Code INSEE de la commune
 * @returns {Promise<Object>} - Objet contenant toutes les propriétés principales de la commune
 */
async function getCommuneDetails(codeInsee, mode = 'full') {
    return new Promise((resolve, reject) => {
        if (!codeInsee || typeof codeInsee !== 'string') {
            return reject(new Error('Code INSEE invalide'));
        }

        // Choisir les champs selon le mode
        let fields;
        if (mode === 'nom') {
            // Mode minimal : nom et code département
            fields = ['nom', 'codeDepartement', 'code'];
        } else {
            // Mode full par défaut : tous les champs utiles
            fields = [
                'nom', 'code', 'codesPostaux', 'population', 'surface', 'centre', 'contour',
                'codeDepartement', 'departement', 'codeRegion', 'region', 'siren', 'epci', 'arrondissement', 'type', 'intercommunalite', 'ancienCode', 'ancienNom'
            ];
        }

        const url = `https://geo.api.gouv.fr/communes/${codeInsee}?fields=${fields.join(',')}&format=json`;
        console.log(`[API_IGN] Récupération des détails pour la commune ${codeInsee} (mode=${mode})`);
        console.log(`[API_IGN] URL: ${url}`);

        https.get(url, (response) => {
            let data = '';
            response.on('data', (chunk) => { data += chunk; });
            response.on('end', () => {
                try {
                    const commune = JSON.parse(data);
                    if (commune && commune.code === codeInsee) {
                        if (mode === 'nom') {
                            // composer "Nom (DD)" — préférer codeDepartement s'il existe
                            const dept = commune.codeDepartement || (commune.code ? commune.code.substring(0, 2) : '');
                            const nom = commune.nom || '';
                            return resolve(`${nom} (${dept})`);
                        }
                        return resolve(commune);
                    } else {
                        console.error('[API_IGN] Commune non trouvée ou réponse inattendue:', commune);
                        return reject(new Error('Commune non trouvée ou réponse inattendue'));
                    }
                } catch (err) {
                    console.error('[API_IGN] Erreur lors du parsing JSON:', err);
                    return reject(new Error(`Erreur lors du parsing de la réponse: ${err.message}`));
                }
            });
        }).on('error', (error) => {
            console.error('[API_IGN] Erreur lors de la requête:', error);
            return reject(new Error(`Erreur réseau: ${error.message}`));
        });
    });
}

module.exports = {
    getCommunesByDepartements,
    getCommuneDetails,

    getParcellesCadastrales,
    getInfosParcellesByIdus,
    getParcellesByCommune,
    parseBboxString,

    validateAndAdjustBbox,
    // Nouvelles fonctions Lizmap
    getLizmapData,
    getLizmapLayerData,
    getLizmapCapabilities,

    createBasicAuth
};