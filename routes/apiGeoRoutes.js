const express = require("express");
const router = express.Router();

/*
=== 🎯 API GEO - Documentation complète ===

Cette API unifiée fournit l'accès aux données géographiques françaises :
1. ✅ Communes par département via geo.api.gouv.fr
2. ✅ Parcelles cadastrales via WFS IGN (data.geopf.fr)
3. ✅ Données CENCA via Lizmap WFS avec authentification

Base URL: /api-geo

--- 🌐 URLs d'accès ---

🏠 Développement local :
http://localhost:8887/api-geo/

--- 💡 Exemples rapides ---

🏘️ Communes du département 10 :
• Local: http://localhost:8887/api-geo/communes?departements=10

📋 Parcelles cadastrales zone Marseille :
• Local: http://localhost:8887/api-geo/parcelles/bbox?bbox=5.3,43.25,5.4,43.35&maxFeatures=2

🗺️ Données CENCA site spécifique :
• Local: http://localhost:8887/api-geo/lizmap/layer/cenca_autres?codesite=10VERP01

--- 🔧 Routes API disponibles ---

🏘️ COMMUNES :
• GET /api-geo/communes?departements=10
  → Récupère les communes par département (défaut: 08,10,51,52)

📋 CADASTRE IGN :
• GET /api-geo/parcelles/bbox?bbox=5.3,43.25,5.4,43.35&maxFeatures=2
  → Parcelles cadastrales par bounding box
• GET /api-geo/parcelles/commune/:codeInsee
  → Toutes les parcelles d'une commune

🗺️ LIZMAP CENCA :
• GET /api-geo/lizmap/capabilities
  → Capacités du service WFS (couches disponibles)
• GET /api-geo/lizmap/layer/cenca_autres?bbox=4.0,48.0,5.0,49.0&maxFeatures=5
  → Données par zone géographique
• GET /api-geo/lizmap/layer/cenca_autres?codesite=10VERP01
  → Données par code site spécifique

🔧 UTILITAIRES :
• GET /api-geo/test → Test de connectivité
• GET /api-geo/info → Informations détaillées sur l'API

--- 🏆 Fonctionnalités intégrées ---

✅ Migration réussie : api_ign.js → geo_api.js
✅ Routes unifiées : /api-ign → /api-geo  
✅ Authentification Lizmap : LIZMAP_USER/LIZMAP_PASSWORD
✅ Format GeoJSON compatible Leaflet
✅ Filtrage avancé : bbox, codesite, maxFeatures
✅ CORS activé pour intégration frontend

--- 📚 Sources de données ---

• IGN Géoportail : data.geopf.fr (parcelles cadastrales)
• API Gouv : geo.api.gouv.fr (communes françaises)
• Lizmap CENCA : cenca.lizmap.com (données environnementales)

Date de migration : 16 octobre 2025 🚀
*/

// Import des fonctions GEO API (IGN + Lizmap)
const { 
    getCommunesByDepartements, 
    getParcellesCadastrales,
    getParcellesByCommune,
    parseBboxString,
    validateAndAdjustBbox,
    // Fonctions Lizmap
    getLizmapData,
    getLizmapLayerData,
    getLizmapCapabilities
} = require("../fonctions/geo_api.js");

/**
 * Route pour récupérer la liste des communes des départements configurés
 * GET /api-geo/communes
 * Paramètres query optionnels:
 * - departements: codes départements séparés par virgules (défaut: 08,10,51,52)
 * - population: true pour inclure la population
 * - codesPostaux: true pour inclure les codes postaux
 */
router.get("/communes", async (req, res) => {
    try {
        console.log("[API-GEO] Demande de récupération des communes");
        
        // Récupération des paramètres
        const departementsParam = req.query.departements || '08,10,51,52';
        const departements = departementsParam.split(',').map(dep => dep.trim());
        
        const options = {
            includePopulation: req.query.population === 'true',
            includeCodesPostaux: req.query.codesPostaux === 'true'
        };
        
        console.log(`[API-GEO] Départements demandés: ${departements.join(', ')}`);
        console.log(`[API-GEO] Options: ${JSON.stringify(options)}`);
        
        const communes = await getCommunesByDepartements(departements, options);
        
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.status(200).json({
            success: true,
            message: `${communes.length} communes récupérées avec succès`,
            departements: departements,
            data: communes
        });
        
    } catch (error) {
        console.error("[API-GEO] Erreur lors de la récupération des communes:", error);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.status(500).json({
            success: false,
            message: "Erreur lors de la récupération des communes",
            error: error.message
        });
    }
});

/**
 * Route pour récupérer les parcelles cadastrales dans une bounding box
 * GET /api-geo/parcelles/bbox
 * Paramètres query requis:
 * - bbox: bounding box au format "minX,minY,maxX,maxY"
 * Paramètres query optionnels:
 * - maxFeatures: nombre maximum de parcelles (défaut: 1000)
 * - srs: système de coordonnées (défaut: EPSG:4326)
 */
router.get("/parcelles/bbox", async (req, res) => {
    try {
        console.log("[API-GEO] Demande de récupération des parcelles par bbox");
        
        if (!req.query.bbox) {
            return res.status(400).json({
                success: false,
                message: "Paramètre 'bbox' requis au format 'minX,minY,maxX,maxY'"
            });
        }
        
        // Parsing et validation de la bbox
        const bbox = parseBboxString(req.query.bbox);
        const validatedBbox = validateAndAdjustBbox(bbox);
        
        const options = {
            maxFeatures: parseInt(req.query.maxFeatures) || 1000,
            srs: req.query.srs || 'EPSG:4326'
        };
        
        console.log(`[API-GEO] Bbox: ${JSON.stringify(validatedBbox)}`);
        console.log(`[API-GEO] Options: ${JSON.stringify(options)}`);
        
        const parcelles = await getParcellesCadastrales(validatedBbox, options);
        
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.status(200).json({
            success: true,
            message: `${parcelles.features.length} parcelles récupérées avec succès`,
            bbox: validatedBbox,
            ...parcelles
        });
        
    } catch (error) {
        console.error("[API-GEO] Erreur lors de la récupération des parcelles par bbox:", error);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.status(500).json({
            success: false,
            message: "Erreur lors de la récupération des parcelles",
            error: error.message
        });
    }
});

/**
 * Route pour récupérer les parcelles cadastrales d'une commune
 * GET /api-geo/parcelles/commune/:codeInsee
 * Paramètres URL:
 * - codeInsee: code INSEE de la commune
 * Paramètres query optionnels:
 * - maxFeatures: nombre maximum de parcelles (défaut: 5000)
 * - srs: système de coordonnées (défaut: EPSG:4326)
 */
router.get("/parcelles/commune/:codeInsee", async (req, res) => {
    try {
        console.log("[API-GEO] Demande de récupération des parcelles par commune");
        
        const codeInsee = req.params.codeInsee;
        
        if (!codeInsee) {
            return res.status(400).json({
                success: false,
                message: "Code INSEE de la commune requis"
            });
        }
        
        const options = {
            maxFeatures: parseInt(req.query.maxFeatures) || 5000,
            srs: req.query.srs || 'EPSG:4326'
        };
        
        console.log(`[API-GEO] Code INSEE: ${codeInsee}`);
        console.log(`[API-GEO] Options: ${JSON.stringify(options)}`);
        
        const parcelles = await getParcellesByCommune(codeInsee, options);
        
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.status(200).json({
            success: true,
            message: `${parcelles.features.length} parcelles récupérées avec succès pour la commune ${codeInsee}`,
            codeInsee: codeInsee,
            ...parcelles
        });
        
    } catch (error) {
        console.error("[API-GEO] Erreur lors de la récupération des parcelles par commune:", error);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.status(500).json({
            success: false,
            message: "Erreur lors de la récupération des parcelles de la commune",
            error: error.message,
            codeInsee: req.params.codeInsee
        });
    }
});

/**
 * Route de test pour vérifier le bon fonctionnement du service
 * GET /api-geo/test
 */
router.get("/test", (req, res) => {
    console.log("[API-GEO] Test de connectivité du service API GEO");
    
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).json({
        success: true,
        message: "Service API IGN opérationnel",
        timestamp: new Date().toISOString(),
        endpoints: {
            communes: "/api-geo/communes",
            parcellesBbox: "/api-geo/parcelles/bbox?bbox=minX,minY,maxX,maxY",
            parcellesCommune: "/api-geo/parcelles/commune/:codeInsee"
        }
    });
});

/**
 * Route pour obtenir des informations sur l'utilisation de l'API
 * GET /api-geo/info
 */
router.get("/info", (req, res) => {
    console.log("[API-GEO] Demande d'informations sur l'API");
    
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).json({
        service: "API IGN pour communes et parcelles cadastrales",
        version: "1.0.0",
        description: "Service pour récupérer les données géographiques depuis les APIs publiques françaises",
        endpoints: [
            {
                path: "/api-geo/communes",
                method: "GET",
                description: "Récupère la liste des communes par départements",
                parameters: {
                    departements: "codes départements séparés par virgules (défaut: 08,10,51,52)",
                    population: "true pour inclure la population",
                    codesPostaux: "true pour inclure les codes postaux"
                }
            },
            {
                path: "/api-geo/parcelles/bbox",
                method: "GET", 
                description: "Récupère les parcelles cadastrales dans une bounding box",
                parameters: {
                    bbox: "bounding box au format 'minX,minY,maxX,maxY' (requis)",
                    maxFeatures: "nombre maximum de parcelles (défaut: 1000)",
                    srs: "système de coordonnées (défaut: EPSG:4326)"
                }
            },
            {
                path: "/api-geo/parcelles/commune/:codeInsee",
                method: "GET",
                description: "Récupère toutes les parcelles d'une commune",
                parameters: {
                    codeInsee: "code INSEE de la commune (requis dans l'URL)",
                    maxFeatures: "nombre maximum de parcelles (défaut: 5000)",
                    srs: "système de coordonnées (défaut: EPSG:4326)"
                }
            }
        ],
        sources: {
            communes: "geo.api.gouv.fr",
            parcelles: "Service WFS Géoportail France (data.geopf.fr/wfs/ows)"
        }
    });
});

/**
 * Route pour récupérer les données d'une couche Lizmap avec filtrage
 * GET /api-geo/lizmap/layer/:layerName
 * Paramètres:
 * - layerName: nom de la couche (ex: cenca_autres)
 * Paramètres query optionnels:
 * - bbox: "xmin,ymin,xmax,ymax" en EPSG:4326
 * - codesite: code du site pour filtrage
 * - maxFeatures: nombre max d'éléments (défaut: 1000)
 */
router.get("/lizmap/layer/:layerName", async (req, res) => {
    try {
        const layerName = req.params.layerName;
        console.log(`[API-GEO] Demande de récupération de la couche Lizmap: ${layerName}`);
        
        // Paramètres optionnels
        const bboxString = req.query.bbox;
        const codesite = req.query.codesite;
        const maxFeatures = parseInt(req.query.maxFeatures) || 1000;
        
        // Validation des paramètres
        if (maxFeatures > 5000) {
            return res.status(400).json({
                error: "maxFeatures ne peut pas dépasser 5000",
                maxAllowed: 5000
            });
        }
        
        // Parsing de la bbox si fournie
        let bboxObject = null;
        if (bboxString) {
            try {
                const bboxArray = bboxString.split(',').map(parseFloat);
                if (bboxArray.length === 4 && bboxArray.every(n => !isNaN(n))) {
                    bboxObject = {
                        minX: bboxArray[0],
                        minY: bboxArray[1], 
                        maxX: bboxArray[2],
                        maxY: bboxArray[3]
                    };
                    console.log(`[API-GEO] Bbox parsée: ${JSON.stringify(bboxObject)}`);
                } else {
                    console.warn(`[API-GEO] Format bbox invalide: ${bboxString}`);
                }
            } catch (e) {
                console.warn(`[API-GEO] Erreur parsing bbox: ${e.message}`);
            }
        }
        
        console.log(`[API-GEO] Paramètres - bbox: ${bboxString}, codesite: ${codesite}, maxFeatures: ${maxFeatures}`);
        
        // Appel de la fonction getLizmapLayerData
        const params = {
            repository: 'cenca',
            project: 'IRENEE', 
            layerName: layerName
        };
        
        const options = {
            bbox: bboxObject,
            codesite: codesite,
            maxFeatures: maxFeatures,
            srs: 'EPSG:4326'
        };
        
        const result = await getLizmapLayerData(params, options);
        
        console.log(`[API-GEO] Données récupérées pour ${layerName}: ${result.features?.length || 0} éléments`);
        
        res.json(result);
        
    } catch (error) {
        console.error(`[API-GEO] Erreur lors de la récupération de la couche ${req.params.layerName}:`, error.message);
        res.status(500).json({
            error: "Erreur lors de la récupération des données Lizmap",
            details: error.message
        });
    }
});

/**
 * Route pour récupérer les capacités d'un service Lizmap
 * GET /api-geo/lizmap/capabilities
 */
router.get("/lizmap/capabilities", async (req, res) => {
    try {
        console.log("[API-GEO] Demande des capacités Lizmap");
        
        const capabilities = await getLizmapCapabilities();
        
        console.log("[API-GEO] Capacités Lizmap récupérées");
        res.json(capabilities);
        
    } catch (error) {
        console.error("[API-GEO] Erreur lors de la récupération des capacités Lizmap:", error.message);
        res.status(500).json({
            error: "Erreur lors de la récupération des capacités Lizmap",
            details: error.message
        });
    }
});

module.exports = router;