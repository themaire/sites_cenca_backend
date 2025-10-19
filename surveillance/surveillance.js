#!/usr/bin/env node

/**
 * 🔍 CENCA API Surveillance System
 * 
 * Système simplifié de surveillance automatique :
 * - Découverte automatique des routes
 * - Test des routes configurées dans routes-config.json
 * - Notifications Telegram intelligentes
 */

require('dotenv').config({ path: '../.env' });
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration globale d'axios pour ignorer les certificats SSL
axios.defaults.httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

// Configuration
const CONFIG = {
    API_BASE_URL: process.env.MONITORING_API_URL || 'https://node_app:8887',
    USERNAME: process.env.MONITORING_USERNAME || 'ttoto',
    PASSWORD: process.env.MONITORING_PASSWORD || 'password',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    CHECK_INTERVAL: parseInt(process.env.MONITORING_INTERVAL || '300000'), // 5 minutes
    TIMEOUT: parseInt(process.env.MONITORING_TIMEOUT || '15000'),
    ROUTES_DIR: '/app/routes',
    CONFIG_FILE: path.join(__dirname, 'routes-config.json')
};

class CencaSurveillance {
    constructor() {
        this.token = null;
        this.tokenExpiry = null;
        this.routesConfig = null;
        this.stats = {
            totalTests: 0,
            successes: 0,
            failures: 0
        };
        
        this.loadConfig();
    }

    log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
        if (data) console.log(JSON.stringify(data, null, 2));
    }

    async sendTelegram(message, isError = false, details = null) {
        if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) return false;

        try {
            const emoji = isError ? '🚨' : '✅';
            let fullMessage = `${emoji} **CENCA Surveillance**\n\n${message}`;
            
            if (details) {
                fullMessage += `\n\n**Détails :**\n${details}`;
            }
            
            fullMessage += `\n\n_${new Date().toLocaleString('fr-FR')}_`;
            
            await axios.post(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: CONFIG.TELEGRAM_CHAT_ID,
                text: fullMessage,
                parse_mode: 'Markdown'
            });

            return true;
        } catch (error) {
            this.log('error', 'Erreur Telegram:', error.message);
            return false;
        }
    }

    loadConfig() {
        try {
            if (fs.existsSync(CONFIG.CONFIG_FILE)) {
                const data = fs.readFileSync(CONFIG.CONFIG_FILE, 'utf8');
                this.routesConfig = JSON.parse(data);
                this.log('info', `📋 Configuration chargée: ${Object.keys(this.routesConfig.routes || {}).length} routes`);
            } else {
                // Copier la config depuis monitoring/ si elle existe
                const monitoringConfig = path.join(__dirname, '../monitoring/routes-config.json');
                if (fs.existsSync(monitoringConfig)) {
                    fs.copyFileSync(monitoringConfig, CONFIG.CONFIG_FILE);
                    this.loadConfig(); // Recharger
                    return;
                }
                
                this.log('warn', '📋 Pas de configuration trouvée, génération automatique...');
                this.generateConfig();
            }
        } catch (error) {
            this.log('error', '📋 Erreur chargement config:', error.message);
            this.routesConfig = { routes: {} };
        }
    }

    generateConfig() {
        this.log('info', '🔍 Génération automatique de la configuration...');
        
        const routes = {};
        const routeFiles = [
            { file: 'menuRoutes.js', mount: '/menu' },
            { file: 'userRoutes.js', mount: '/auth' },
            { file: 'getSitesRoutes.js', mount: '/sites' },
            { file: 'putSitesRoutes.js', mount: '/sites' },
            { file: 'deleteSitesRoutes.js', mount: '/sites' },
            { file: 'foncierRoutes.js', mount: '/sites' },
            { file: 'processRoutes.js', mount: '/process' },
            { file: 'pictureRoute.js', mount: '/picts' },
            { file: 'apiGeoRoutes.js', mount: '/api-geo' }
        ];

        let totalRoutes = 0;
        let routesWithParams = 0;

        for (const { file, mount } of routeFiles) {
            const filePath = path.join(CONFIG.ROUTES_DIR, file);
            if (fs.existsSync(filePath)) {
                const discoveredRoutes = this.analyzeRouteFile(filePath, mount);
                totalRoutes += discoveredRoutes.length;
                
                discoveredRoutes.forEach(route => {
                    // Inclure TOUTES les routes avec paramètres (pas seulement les complexes)
                    if (this.hasParameters(route.fullPath)) {
                        routesWithParams++;
                        const isEnabled = route.fullPath.includes('/criteria'); // Activer par défaut la route criteria
                        
                        routes[route.fullPath] = {
                            method: route.method,
                            file: file,
                            enabled: isEnabled,
                            parameters: this.extractParametersWithExamples(route.fullPath),
                            priority: this.assessPriority(route.fullPath),
                            category: this.categorizeRoute(route.fullPath),
                            note: this.generateRouteNote(route.fullPath, route.method)
                        };
                    }
                });
            }
        }

        this.routesConfig = {
            metadata: {
                description: "Configuration complète des routes CENCA avec paramètres",
                generated: new Date().toISOString(),
                version: "2.1.0",
                stats: {
                    totalRoutes: totalRoutes,
                    routesWithParams: routesWithParams,
                    enabledRoutes: Object.values(routes).filter(r => r.enabled).length
                }
            },
            settings: {
                defaultTimeout: 15000,
                retryCount: 2,
                notificationThreshold: 80,
                testInterval: 300000
            },
            routes: routes
        };

        this.saveConfig();
        this.log('info', `📋 Configuration générée: ${routesWithParams}/${totalRoutes} routes avec paramètres détectées`);
    }

    analyzeRouteFile(filePath, mountPath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const routes = [];
            const routeRegex = /router\.(get|post|put|delete)\s*\(\s*["']([^"']+)["']/g;
            
            let match;
            while ((match = routeRegex.exec(content)) !== null) {
                const [, method, pattern] = match;
                routes.push({
                    method: method.toUpperCase(),
                    pattern: pattern,
                    fullPath: mountPath + pattern
                });
            }
            
            return routes;
        } catch (error) {
            this.log('error', `Erreur analyse ${filePath}:`, error.message);
            return [];
        }
    }

    hasParameters(path) {
        // Toutes les routes avec des paramètres (:param)
        return path.includes(':');
    }

    isComplexRoute(path) {
        // Routes nécessitant des paramètres spécifiques
        return path.includes(':') && (
            path.includes('uuid') ||
            path.includes('criteria') ||
            path.match(/:[\w]+.*:[\w]+/) || // 2+ paramètres
            ['POST', 'PUT', 'DELETE'].some(method => path.includes(method))
        );
    }

    extractParameters(path) {
        const params = {};
        const paramRegex = /:([a-zA-Z_][a-zA-Z0-9_]*)\??/g;
        
        let match;
        while ((match = paramRegex.exec(path)) !== null) {
            const paramName = match[1];
            params[paramName] = [];
        }
        
        return params;
    }

    extractParametersWithExamples(path) {
        const params = {};
        const paramRegex = /:([a-zA-Z_][a-zA-Z0-9_]*)\??/g;
        
        let match;
        while ((match = paramRegex.exec(path)) !== null) {
            const paramName = match[1];
            params[paramName] = this.getParameterExamples(paramName);
        }
        
        return params;
    }

    getParameterExamples(paramName) {
        const examples = {
            // IDs et UUIDs
            'uuid': ['12345678-1234-1234-1234-123456789abc'],
            'id': ['1', '123'],
            
            // Critères de recherche
            'type': ['ALL', 'APHN', 'TERR'],
            'code': ['52003', '51001', '08001'],
            'nom': ['test', 'exemple'],
            'commune': ['test', 'ALL'],
            'milnat': ['ALL', 'FOR', 'HUM'],
            'resp': ['ALL', 'CENCA'],
            
            // Types de données
            'table': ['sites', 'operations', 'actes'],
            'option': ['communes', 'milieux', 'responsables'],
            'parent': ['null', '1', '2'],
            
            // Autres
            'format': ['json', 'xml'],
            'year': ['2024', '2023'],
            'month': ['01', '12']
        };
        
        return examples[paramName] || ['valeur_exemple'];
    }

    categorizeRoute(path) {
        if (path.includes('/auth')) return 'Authentication';
        if (path.includes('/sites')) return 'Sites Management';
        if (path.includes('/process')) return 'Data Processing';
        if (path.includes('/menu')) return 'Navigation';
        if (path.includes('/picts')) return 'Media';
        if (path.includes('/api-geo')) return 'Geographic API';
        return 'Other';
    }

    generateRouteNote(path, method) {
        const notes = {
            criteria: "Recherche multicritères dans les sites",
            uuid: "Accès par identifiant unique",
            selectors: "Données pour les sélecteurs de formulaire",
            login: "Authentification utilisateur",
            me: "Informations utilisateur connecté",
            verify: "Vérification de token JWT",
            parent: "Navigation hiérarchique des menus"
        };
        
        for (const [key, note] of Object.entries(notes)) {
            if (path.includes(key)) return note;
        }
        
        return `Route ${method} avec paramètres - À configurer selon les besoins`;
    }

    assessPriority(path) {
        if (path.includes('auth') || path.includes('criteria')) return 'HIGH';
        if (path.includes('uuid') || path.includes('selectors')) return 'MEDIUM';
        return 'LOW';
    }

    saveConfig() {
        try {
            this.routesConfig.metadata.lastUpdate = new Date().toISOString();
            fs.writeFileSync(CONFIG.CONFIG_FILE, JSON.stringify(this.routesConfig, null, 2));
            this.log('info', '📋 Configuration sauvegardée');
        } catch (error) {
            this.log('error', '📋 Erreur sauvegarde:', error.message);
        }
    }

    async authenticate() {
        try {
            const response = await axios.post(`${CONFIG.API_BASE_URL}/auth/login`, {
                username: CONFIG.USERNAME,
                password: CONFIG.PASSWORD
            }, { timeout: CONFIG.TIMEOUT });

            if (response.data.token) {
                this.token = response.data.token;
                this.tokenExpiry = Date.now() + (55 * 60 * 1000); // 55 minutes
                this.log('info', '🔐 Authentification réussie');
                return true;
            }
            throw new Error('Pas de token reçu');
        } catch (error) {
            this.log('error', '🔐 Échec authentification:', error.message);
            return false;
        }
    }

    isTokenValid() {
        return this.token && this.tokenExpiry && Date.now() < this.tokenExpiry;
    }

    async ensureAuth() {
        if (!this.isTokenValid()) {
            return await this.authenticate();
        }
        return true;
    }

    getEnabledRoutes() {
        if (!this.routesConfig?.routes) return [];
        
        return Object.entries(this.routesConfig.routes)
            .filter(([path, config]) => config.enabled === true)
            .map(([path, config]) => ({ path, config }));
    }

    async discoverActiveRoutes() {
        try {
            await this.ensureAuth();
            
            // Tenter de récupérer les routes actives depuis l'API si elle a un endpoint de debug
            const response = await axios.get(`${CONFIG.API_BASE_URL}/debug/routes`, {
                headers: { Authorization: `Bearer ${this.token}` },
                timeout: CONFIG.TIMEOUT,
                validateStatus: () => true // Accepter toutes les réponses
            });
            
            if (response.status === 200 && response.data) {
                this.log('info', '🔍 Routes découvertes depuis l\'API Express');
                const routesArray = Array.isArray(response.data.routes) ? response.data.routes : [];
                const routePaths = routesArray.map(r => r.path).join('\n');
                console.log('DEBUG routes actives:', routePaths);
                return routesArray;
            }
        } catch (error) {
            this.log('warn', 'Debug endpoint non disponible, analyse des fichiers...');
        }
        
        // Fallback : analyser les fichiers de routes
        try {
            const routes = this.analyzeRouteFiles();
            return Array.isArray(routes) ? routes : [];
        } catch (error) {
            this.log('error', 'Erreur lors de l\'analyse des fichiers de routes:', error.message);
            return [];
        }
    }

    analyzeRouteFiles() {
        const discoveredRoutes = [];
        const routeFiles = [
            { file: 'menuRoutes.js', mount: '/menu' },
            { file: 'userRoutes.js', mount: '/auth' },
            { file: 'getSitesRoutes.js', mount: '/sites' },
            { file: 'putSitesRoutes.js', mount: '/sites' },
            { file: 'deleteSitesRoutes.js', mount: '/sites' },
            { file: 'foncierRoutes.js', mount: '/sites' },
            { file: 'processRoutes.js', mount: '/process' },
            { file: 'pictureRoute.js', mount: '/picts' }
        ];

        for (const { file, mount } of routeFiles) {
            try {
                const filePath = path.join(CONFIG.ROUTES_DIR, file);
                if (fs.existsSync(filePath)) {
                    const routes = this.analyzeRouteFile(filePath, mount);
                    if (Array.isArray(routes)) {
                        discoveredRoutes.push(...routes);
                    }
                }
            } catch (error) {
                this.log('error', `Erreur analyse fichier ${file}:`, error.message);
            }
        }

        this.log('info', `🔍 ${discoveredRoutes.length} routes découvertes par analyse`);
        return discoveredRoutes;
    }

    buildTestUrl(path, parameters) {
        let url = path;
        
        for (const [paramName, values] of Object.entries(parameters || {})) {
            if (values && values.length > 0) {
                // Prendre la première valeur ou une valeur aléatoire
                const value = Array.isArray(values) ? values[0] : values;
                url = url.replace(`:${paramName}`, value);
            } else if (typeof values === 'string' && values) {
                url = url.replace(`:${paramName}`, values);
            }
        }
        
        return url;
    }

    async testRoute(routePath, config) {
        await this.ensureAuth();
        
        const testUrl = this.buildTestUrl(routePath, config.parameters || {});
        const fullUrl = `${CONFIG.API_BASE_URL}${testUrl}`;
        
        try {
            const startTime = Date.now();
            const response = await axios.get(fullUrl, {
                headers: { Authorization: `Bearer ${this.token}` },
                timeout: CONFIG.TIMEOUT,
                validateStatus: status => status < 500
            });
            const responseTime = Date.now() - startTime;

            const success = response.status === 200;
            const result = {
                success,
                status: response.status,
                responseTime,
                url: testUrl,
                data: response.data ? (Array.isArray(response.data) ? `${response.data.length} items` : 'Object') : 'No data'
            };

            if (success) {
                this.log('info', `✅ ${routePath}: OK (${responseTime}ms, ${result.data})`);
                this.stats.successes++;
            } else {
                this.log('warn', `⚠️  ${routePath}: Status ${response.status}`);
                this.stats.failures++;
            }

            this.stats.totalTests++;
            return result;
        } catch (error) {
            this.log('error', `❌ ${routePath}: ${error.message}`);
            this.stats.failures++;
            this.stats.totalTests++;
            return { success: false, error: error.message, url: testUrl };
        }
    }

    async runSurveillance() {
        let activeRoutes = [];
        try {
            activeRoutes = await this.discoverActiveRoutes();
            if (!Array.isArray(activeRoutes)) activeRoutes = [];
        } catch (error) {
            activeRoutes = [];
        }

        const enabledRoutes = this.getEnabledRoutes();

        this.log('info', `🔍 ${activeRoutes.length} routes actives découvertes`);
        this.log('info', `🎯 ${enabledRoutes.length} routes configurées à tester`);
        this.log('info', '🚀 === DÉMARRAGE SURVEILLANCE CENCA ===');

        if (!await this.ensureAuth()) {
            await this.sendTelegram('🚨 **ÉCHEC AUTHENTIFICATION**\nImpossible de se connecter à l\'API', true);
            return;
        }

        // Vérifier la cohérence entre routes configurées et routes actives
        const routeAnalysis = this.analyzeRoutesCoherence(enabledRoutes, activeRoutes);
        
        if (enabledRoutes.length === 0) {
            this.log('warn', '⚠️  Aucune route activée dans la configuration');
            return;
        }

        const results = [];
        
        for (const { path, config } of enabledRoutes) {
            const result = await this.testRoute(path, config);
            results.push({ path, result });
        }

        // Calculer les statistiques
        const successCount = results.filter(r => r.result.success).length;
        const totalCount = results.length;
        const successRate = Math.round((successCount / totalCount) * 100);

        this.log('info', `📊 Résultats: ${successCount}/${totalCount} (${successRate}%)`);

        // Afficher la liste des routes qui ont réussi
        const succeededRoutes = results.filter(r => r.result.success)
            .map(r => `✅ ${r.path} (${r.result.responseTime || '?'}ms)`);
        if (succeededRoutes.length > 0) {
            this.log('info', `✅ Routes réussies :\n${succeededRoutes.join('\n')}`);
        }

        // Préparer les détails pour Telegram
        const telegramDetails = this.buildTelegramReport(results, routeAnalysis, activeRoutes.length);

        // Notification Telegram si nécessaire
        if (successRate < 100) {
            const failedRoutes = results.filter(r => !r.result.success).map(r => r.path);
            const failedDetails = results.filter(r => !r.result.success)
                .map(r => `• ${r.path}: ${r.result.error || `Status ${r.result.status}`}`)
                .join('\n');
            
            await this.sendTelegram(
                `⚠️  **PROBLÈMES DÉTECTÉS**\n\n` +
                `📊 Taux de réussite: ${successRate}%\n` +
                `❌ Routes en échec: ${failedRoutes.length}\n` +
                `🔍 ${totalCount} routes testées\n\n` +
                `**Routes en défaut:**\n${failedDetails}`,
                true,
                telegramDetails
            );
        } else if (this.stats.totalTests % 10 === 0) { // Notification périodique
            await this.sendTelegram(
                `✅ **Surveillance OK**\n\n${successCount}/${totalCount} routes fonctionnelles`,
                false,
                telegramDetails
            );
        }

        this.log('info', '🚀 === FIN SURVEILLANCE ===\n');
    }

    analyzeRoutesCoherence(enabledRoutes, activeRoutes) {
        const analysis = {
            configured: enabledRoutes.length,
            active: activeRoutes.length,
            matching: 0,
            missing: [],
            extra: []
        };

        const configuredPaths = enabledRoutes.map(r => r.path);
        const activePaths = Array.isArray(activeRoutes) ? activeRoutes.map(r => r.fullPath || r.path) : [];

        // Routes configurées mais pas actives
        analysis.missing = configuredPaths.filter(path => 
            !activePaths.some(activePath => this.routesMatch(path, activePath))
        );

        // Routes actives correspondant aux configurées
        analysis.matching = configuredPaths.filter(path => 
            activePaths.some(activePath => this.routesMatch(path, activePath))
        ).length;

        return analysis;
    }

    routesMatch(configPath, activePath) {
        // Comparaison simple pour détecter si les routes correspondent
        return configPath === activePath || 
               configPath.replace(/:\w+/g, '*') === activePath.replace(/:\w+/g, '*');
    }

    buildTelegramReport(results, routeAnalysis, totalActiveRoutes) {
        let report = `🔍 **Routes Express:** ${totalActiveRoutes} actives\n`;
        report += `⚙️  **Configurées:** ${routeAnalysis.configured}\n`;
        report += `✅ **Correspondances:** ${routeAnalysis.matching}\n`;
        
        if (routeAnalysis.missing.length > 0) {
            report += `⚠️  **Manquantes:** ${routeAnalysis.missing.length}\n`;
        }

        const responseTimes = results.map(r => r.result.responseTime).filter(t => t);
        if (responseTimes.length > 0) {
            const avgTime = Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length);
            report += `⏱️  **Temps moyen:** ${avgTime}ms`;
        }

        return report;
    }

    async regenerateConfig() {
        this.log('info', '🔄 Régénération complète de la configuration...');
        
        // Sauvegarder les configurations utilisateur existantes
        const existingConfig = this.routesConfig ? {...this.routesConfig.routes} : {};
        
        // Générer la nouvelle configuration
        this.generateConfig();
        
        // Restaurer les paramètres utilisateur
        Object.keys(this.routesConfig.routes).forEach(routePath => {
            if (existingConfig[routePath]) {
                // Préserver les configurations utilisateur
                this.routesConfig.routes[routePath].enabled = existingConfig[routePath].enabled || false;
                if (existingConfig[routePath].parameters) {
                    this.routesConfig.routes[routePath].parameters = existingConfig[routePath].parameters;
                }
            }
        });
        
        this.saveConfig();
        this.log('info', '✅ Configuration régénérée avec préservation des paramètres utilisateur');
    }

    async start() {
        this.log('info', '🔍 Démarrage du système de surveillance CENCA');
        
        // Régénérer la configuration au démarrage pour inclure toutes les routes
        this.log('info', '🔄 Lancement de la régénération...');
        await this.regenerateConfig();
        
        // Première exécution
        await this.runSurveillance();
        
        // Programmation périodique
        setInterval(async () => {
            await this.runSurveillance();
        }, CONFIG.CHECK_INTERVAL);

        this.log('info', `⏰ Surveillance programmée toutes les ${CONFIG.CHECK_INTERVAL / 1000} secondes`);
    }
}

// Démarrage
if (require.main === module) {
    const surveillance = new CencaSurveillance();
    surveillance.start().catch(console.error);
}

module.exports = CencaSurveillance;