const https = require('https');
const http = require('http');

/**
 * Unified helper for robust API requests to geo.api.gouv.fr and similar
 * @param {string} url - Full URL to fetch
 * @param {number} maxRetries - Max retries for 5xx errors (default: 2)
 * @returns {Promise<Object>} Parsed JSON response
 */
async function fetchApi(url, maxRetries = 2) {
    return new Promise((resolve, reject) => {
        let retries = 0;
        
        const attemptRequest = () => {
            console.log(`[API_FETCH] Requesting: ${url} (attempt ${retries + 1}/${maxRetries + 1})`);
            
            const request = https.get(url, (response) => {
                const contentType = response.headers['content-type'] || '';
                let data = '';
                
                // Status check
                if (response.statusCode !== 200) {
                    const preview = data.substring(0, 200);
                    console.error(`[API_FETCH] HTTP ${response.statusCode}: ${preview}`);
                    
                    if (response.statusCode >= 500 && retries < maxRetries) {
                        retries++;
                        console.log(`[API_FETCH] Retrying... (${retries}/${maxRetries})`);
                        return setTimeout(attemptRequest, 1000 * retries);
                    }
                    
                    return reject(new Error(`HTTP ${response.statusCode}: ${preview}`));
                }
                
                if (!contentType.includes('application/json')) {
                    response.resume();
                    return reject(new Error(`Expected JSON, got ${contentType}`));
                }
                
                response.on('data', (chunk) => data += chunk);
                response.on('end', () => {
                    if (data.trim().startsWith('<')) {
                        console.error('[API_FETCH] HTML response:', data.substring(0, 200));
                        return reject(new Error('Server returned HTML error'));
                    }
                    
                    try {
                        resolve(JSON.parse(data));
                    } catch (parseError) {
                        reject(new Error(`JSON parse failed: ${parseError.message}`));
                    }
                });
                
                response.setTimeout(10000, () => {
                    response.destroy();
                    reject(new Error('Response timeout'));
                });
            });
            
            request.on('error', (error) => {
                if (retries < maxRetries) {
                    retries++;
                    setTimeout(attemptRequest, 1000 * retries);
                } else {
                    reject(error);
                }
            });
            
            request.setTimeout(10000, () => request.destroy(new Error('Request timeout')));
        };
        
        attemptRequest();
    });
}

// Récupère les communes pour les départements Grand-Est
async function getCommunesByDepartements(departements = ['08', '10', '51', '52'], options = {}) {
    try {
        let fields = ['nom', 'code'];
        if (options.includePopulation) fields.push('population');
        if (options.includeCodesPostaux) fields.push('codesPostaux');
        
        const departementsStr = departements.join(',');
        const fieldsStr = fields.join(',');
        const url = `https://geo.api.gouv.fr/communes?codeDepartement=${departementsStr}&fields=${fieldsStr}&format=json`;
        
        console.log(`[API_IGN] URL communes: ${url}`);
        const communes = await fetchApi(url);
        
        if (Array.isArray(communes)) {
            communes.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
            return communes;
        }
        throw new Error('Format de réponse inattendu');
    } catch (error) {
        console.error('[API_IGN] Erreur getCommunesByDepartements:', error);
        throw error;
    }
}

/**
 * Récupère les parcelles cadastrales via WFS IGN dans une bounding box
 */
async function getParcellesCadastrales(bbox, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            const { srs = 'EPSG:4326', maxFeatures = 1000 } = options;
            
            if (!bbox || typeof bbox.minX === 'undefined') {
                return reject(new Error('Bounding box invalide'));
            }
            
            const params = new URLSearchParams({
                'SERVICE': 'WFS',
                'VERSION': '2.0.0',
                'REQUEST': 'GetFeature',
                'TYPENAME': 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle',
                'OUTPUTFORMAT': 'application/json',
                'SRSNAME': srs,
                'BBOX': `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY}`,
                'MAXFEATURES': maxFeatures.toString()
            });
            
            const url = `https://data.geopf.fr/wfs/ows?${params}`;
            
            console.log(`[API_IGN] WFS bbox: ${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY}`);
            
            https.get(url, (response) => {
                let data = '';
                
                response.on('data', (chunk) => data += chunk);
                response.on('end', () => {
                    try {
                        const geoJson = JSON.parse(data);
                        
                        if (geoJson.type === 'FeatureCollection') {
                            console.log(`[API_IGN] ${geoJson.features.length} parcelles WFS`);
                            
                            if (geoJson.features.length > maxFeatures) {
                                geoJson.features = geoJson.features.slice(0, maxFeatures);
                            }
                            
                            resolve(geoJson);
                        } else if (geoJson.type === 'ExceptionReport') {
                            reject(new Error(`WFS Error: ${geoJson.Exception?.ExceptionText || 'Unknown'}`));
                        } else {
                            reject(new Error('WFS response invalid'));
                        }
                    } catch (parseError) {
                        reject(new Error(`WFS parse error: ${parseError.message}`));
                    }
                });
            }).on('error', reject).setTimeout(15000, () => reject(new Error('WFS timeout')));
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Récupère parcelles cadastrales pour commune INSEE via bbox
 */
async function getParcellesByCommune(codeInsee, options = {}) {
    try {
        const { maxFeatures = 5000, srs = 'EPSG:4326' } = options;
        
        const paddedInsee = codeInsee.padStart(5, '0');
        const communeUrl = `https://geo.api.gouv.fr/communes/${paddedInsee}?fields=centre,contour&format=json`;
        
        const commune = await fetchApi(communeUrl);
        
        if (!commune.contour) {
            throw new Error(`Commune ${codeInsee} limits not found`);
        }
        
        // Compute bbox from contour
        const coordinates = commune.contour.coordinates[0];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        coordinates.forEach(([x, y]) => {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        });
        
        const bbox = { minX, minY, maxX, maxY };
        
        // Request WFS with generous limit for filtering
        const parcelles = await getParcellesCadastrales(bbox, {
            maxFeatures: Math.max(maxFeatures * 3, 1000),
            srs
        });
        
        // Filter to exact commune
        const filtered = parcelles.features.filter(f => 
            !f.properties.insee_com || f.properties.insee_com === codeInsee
        ).slice(0, maxFeatures);
        
        return {
            ...parcelles,
            features: filtered
        };
    } catch (error) {
        console.error('[API_IGN] getParcellesByCommune error:', error);
        throw error;
    }
}

/**
 * Parse parcelle IDU flexibly
 */
function parseIduFlexible(idu) {
    const iduStr = String(idu).trim();
    const match = iduStr.match(/^(\d{5})(\d+)([A-Z]{1,2})(\d{1,4})$/i);
    
    if (!match) {
        console.warn(`[parseIduFlexible] Invalid format: ${iduStr}`);
        return null;
    }
    
    const [, code_insee, prefixe, section, numero] = match;
    return {
        code_insee,
        section: section.padStart(2, '0'),
        numero: numero.padStart(4, '0')
    };
}

/**
 * Get parcel info by IDU from apicarto.ign.fr
 */
async function getInfosParcellesByIdus(idus = [], options = {}) {
    if (!Array.isArray(idus) || idus.length === 0) {
        throw new Error('Empty IDU list');
    }
    
    const results = [];
    for (const idu of idus) {
        const parsed = parseIduFlexible(idu);
        if (!parsed) continue;
        
        const { code_insee, section, numero } = parsed;
        const url = `https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=${code_insee}&section=${section}&numero=${numero}`;
        
        try {
            const response = await fetchApi(url);
            if (response.features?.[0]) {
                const props = response.features[0].properties;
                results.push({
                    idu: props.idu || props.code_parcelle,
                    nom_com: props.nom_com || props.nom_commune,
                    contenance: props.contenance,
                    section: props.section,
                    numero: props.numero,
                    bbox: response.bbox?.join(',')
                });
            }
        } catch (e) {
            console.warn(`[API_CARTO_IGN] Failed for ${idu}:`, e.message);
        }
    }
    
    return results;
}

// Utility functions
function parseBboxString(bboxString) {
    const coords = bboxString.split(',').map(Number);
    if (coords.length !== 4) throw new Error('Invalid bbox format');
    return { minX: coords[0], minY: coords[1], maxX: coords[2], maxY: coords[3] };
}

function validateAndAdjustBbox(bbox, maxArea = 0.1) {
    const { minX, minY, maxX, maxY } = bbox;
    if (minX >= maxX || minY >= maxY) throw new Error('Invalid bbox');
    
    const area = (maxX - minX) * (maxY - minY);
    if (area > maxArea) {
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

// Lizmap functions (placeholder - implement if needed)
async function getLizmapData(params, options = {}) {
    // Placeholder - implement Lizmap WFS if needed
    throw new Error('Lizmap functions not implemented');
}

module.exports = {
    getCommunesByDepartements,
    getParcellesCadastrales,
    getParcellesByCommune,
    getInfosParcellesByIdus,
    parseIduFlexible,
    parseBboxString,
    validateAndAdjustBbox,
    getLizmapData
};

