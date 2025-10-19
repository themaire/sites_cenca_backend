#!/usr/bin/env node

/**
 * 🤖 Health Check Service AUTOMATIQUE pour l'API CENCA
 * 
 * Ce service analyse automatiquement tous les fichiers de routes et teste
 * intelligemment chaque endpoint avec des paramètres appropriés.
 * 
 * Fonctionnalités avancées :
 * - Découverte automatique des routes depuis les fichiers
 * - Détection intelligente des paramètres requis/optionnels
 * - Génération de valeurs de test appropriées
 * - Gestion des différents types de routes (GET/POST/PUT/DELETE)
 * - Classification par criticité
 * 
 * En cas de problème → Notification Telegram détaillée
 */

require('dotenv').config({ path: '../.env' });
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration depuis .env
const CONFIG = {
    API_BASE_URL: process.env.MONITORING_API_URL || 'http://node_app:8887',
    TEST_USERNAME: process.env.MONITORING_USERNAME || 'nelie',
    TEST_PASSWORD: process.env.MONITORING_PASSWORD || 'password',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    CHECK_INTERVAL: parseInt(process.env.MONITORING_INTERVAL || '300000'), // 5 minutes
    TIMEOUT: parseInt(process.env.MONITORING_TIMEOUT || '15000'), // 15 secondes pour les routes complexes
    LOG_FILE: path.join(__dirname, 'logs', 'health-check-auto.log'),
    ROUTES_DIR: '/app/routes', // Dossier des routes (monté depuis l'host dans le container)
    ROUTES_CONFIG_FILE: path.join(__dirname, 'routes-config.json') // Configuration des paramètres
};

// Valeurs de test par défaut pour différents types de paramètres
const TEST_VALUES = {
    uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', // UUID valide fictif
    id: '1',
    code: 'TEST',
    nom: 'test',
    commune: '08001', // Code INSEE fictif des Ardennes
    milnat: 'FORET',
    resp: 'NE',
    type: '*',
    mode: 'lite',
    option: '1',
    list: 'admin.salaries',
    section: '1',
    cd_type: '1',
    ref_id: '1',
    // Valeurs par défaut pour les paramètres génériques
    default: '*'
};

class AutoHealthChecker {
    constructor() {
        this.token = null;
        this.userInfo = null;
        this.discoveredRoutes = [];
        this.routesConfig = {};
        this.stats = {
            totalChecks: 0,
            failures: 0,
            lastCheck: null,
            lastSuccess: null,
            consecutiveFailures: 0,
            routesDiscovered: 0,
            routesTested: 0
        };
        
        this.initializeLogging();
        this.loadRoutesConfig();
    }

    initializeLogging() {
        try {
            const logsDir = path.dirname(CONFIG.LOG_FILE);
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            if (!fs.existsSync(CONFIG.LOG_FILE)) {
                fs.writeFileSync(CONFIG.LOG_FILE, '');
            }
        } catch (error) {
            console.log(`[WARNING] Could not create log file: ${error.message}. Using console only.`);
        }
    }

    log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
        
        console.log(logEntry);
        if (data) console.log(JSON.stringify(data, null, 2));
        
        try {
            fs.appendFileSync(CONFIG.LOG_FILE, logEntry + '\n');
            if (data) {
                fs.appendFileSync(CONFIG.LOG_FILE, JSON.stringify(data, null, 2) + '\n');
            }
        } catch (error) {
            // Ignorer silencieusement
        }
    }

    async sendTelegramNotification(message, isError = false) {
        if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
            this.log('warn', 'Configuration Telegram manquante');
            return false;
        }

        try {
            const emoji = isError ? '🚨' : '✅';
            const fullMessage = `${emoji} **CENCA API Monitor AUTO**\n\n${message}\n\n_${new Date().toLocaleString('fr-FR')}_`;
            
            await axios.post(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: CONFIG.TELEGRAM_CHAT_ID,
                text: fullMessage,
                parse_mode: 'Markdown'
            });

            this.log('info', 'Notification Telegram envoyée');
            return true;
        } catch (error) {
            this.log('error', 'Erreur envoi Telegram', error.message);
            return false;
        }
    }

    /**
     * Charge la configuration des routes depuis le fichier JSON
     */
    loadRoutesConfig() {
        try {
            if (fs.existsSync(CONFIG.ROUTES_CONFIG_FILE)) {
                const configData = fs.readFileSync(CONFIG.ROUTES_CONFIG_FILE, 'utf8');
                if (configData.trim() !== '' && configData.trim() !== '{}') {
                    const parsed = JSON.parse(configData);
                    // Vérifier la structure
                    if (parsed.routes) {
                        this.routesConfig = parsed;
                        this.log('info', `📋 Configuration chargée: ${Object.keys(this.routesConfig.routes || {}).length} routes configurées`);
                    } else {
                        this.log('warn', '📋 Structure de configuration invalide, réinitialisation...');
                        this.initializeEmptyConfig();
                    }
                } else {
                    this.log('warn', '📋 Fichier de configuration vide, création automatique...');
                    this.initializeEmptyConfig();
                }
            } else {
                this.log('warn', '📋 Fichier de configuration non trouvé, création automatique...');
                this.initializeEmptyConfig();
            }
        } catch (error) {
            this.log('error', '📋 Erreur chargement configuration', error.message);
            this.routesConfig = { metadata: {}, routes: {} };
        }
    }

    /**
     * Initialise une configuration vide avec la structure correcte
     */
    initializeEmptyConfig() {
        this.routesConfig = {
            metadata: {
                description: "Configuration des paramètres pour les routes nécessitant des données spécifiques",
                lastUpdate: new Date().toISOString(),
                version: "1.0.0",
                autoGenerated: true
            },
            routes: {}
        };
        this.saveRoutesConfig();
    }

    /**
     * Sauvegarde la configuration des routes
     */
    saveRoutesConfig() {
        try {
            this.routesConfig.metadata.lastUpdate = new Date().toISOString();
            const configJson = JSON.stringify(this.routesConfig, null, 2);
            fs.writeFileSync(CONFIG.ROUTES_CONFIG_FILE, configJson, 'utf8');
            this.log('info', '📋 Configuration sauvegardée');
        } catch (error) {
            this.log('error', '📋 Erreur sauvegarde configuration', error.message);
        }
    }

    /**
     * Met à jour automatiquement la configuration avec les nouvelles routes découvertes
     */
    updateRoutesConfig(discoveredRoutes) {
        let updated = false;
        
        // Parcourir les routes non-testables pour les ajouter à la config
        discoveredRoutes.filter(route => !route.testable).forEach(route => {
            const routePattern = route.fullPath;
            
            if (!this.routesConfig.routes[routePattern]) {
                // Nouvelle route découverte
                this.routesConfig.routes[routePattern] = {
                    description: `Route ${route.method} découverte automatiquement`,
                    parameters: this.extractParametersConfig(route),
                    enabled: false,
                    priority: route.criticality,
                    examples: [],
                    note: "Paramètres à renseigner manuellement",
                    file: route.file,
                    method: route.method,
                    discovered: new Date().toISOString()
                };
                updated = true;
                this.log('info', `📋 Nouvelle route ajoutée à la config: ${routePattern}`);
            }
        });
        
        if (updated) {
            this.saveRoutesConfig();
        }
    }

    /**
     * Extrait la configuration des paramètres depuis une route
     */
    extractParametersConfig(route) {
        const params = {};
        
        route.params.forEach(param => {
            if (param.name === 'uuid') {
                params[param.name] = [];
            } else if (param.name === 'mode') {
                params[param.name] = ['lite', 'full'];
            } else if (param.name === 'id') {
                params[param.name] = [];
            } else {
                params[param.name] = [];
            }
        });
        
        return params;
    }

    /**
     * Génère une URL de test depuis la configuration ou les valeurs par défaut
     */
    generateConfiguredTestUrl(route) {
        const config = this.routesConfig.routes[route.fullPath];
        
        if (!config || !config.enabled || !config.parameters) {
            return null; // Route non configurée ou désactivée
        }
        
        let url = route.fullPath;
        let hasAllParams = true;
        
        // Remplacer chaque paramètre par une valeur de la configuration
        route.params.forEach(param => {
            const configValues = config.parameters[param.name];
            if (configValues && configValues.length > 0) {
                // Prendre une valeur aléatoire de la configuration
                const randomValue = configValues[Math.floor(Math.random() * configValues.length)];
                url = url.replace(`:${param.name}`, randomValue);
            } else {
                hasAllParams = false;
            }
        });
        
        return hasAllParams ? url : null;
    }

    /**
     * Analyse un fichier de route et extrait toutes les définitions de routes
     */
    analyzeRouteFile(filePath, mountPath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const routes = [];
            
            // Regex pour capturer les définitions de routes Express
            // Supporte : router.get(), router.post(), router.put(), router.delete()
            const routeRegex = /router\.(get|post|put|delete)\s*\(\s*["']([^"']+)["']/g;
            
            let match;
            while ((match = routeRegex.exec(content)) !== null) {
                const [, method, pattern] = match;
                
                // Analyser les paramètres dans la route
                const params = this.extractRouteParams(pattern);
                
                // Créer l'objet route
                const testable = this.isTestable(pattern, method);
                const route = {
                    method: method.toUpperCase(),
                    pattern,
                    fullPath: mountPath + pattern,
                    params,
                    file: path.basename(filePath),
                    criticality: this.assessCriticality(pattern, method),
                    testable: testable
                };
                
                // Debug: log des routes filtrées
                if (!testable) {
                    this.log('debug', `🚫 Route filtrée: ${pattern} (${method}) - ${path.basename(filePath)}`);
                }
                
                routes.push(route);
            }
            
            return routes;
        } catch (error) {
            this.log('error', `Erreur analyse fichier ${filePath}`, error.message);
            return [];
        }
    }

    /**
     * Extrait les paramètres d'une route Express
     */
    extractRouteParams(pattern) {
        const params = [];
        // Regex pour capturer :param et :param?
        const paramRegex = /:([a-zA-Z_][a-zA-Z0-9_]*)\??/g;
        
        let match;
        while ((match = paramRegex.exec(pattern)) !== null) {
            const [fullMatch, paramName] = match;
            params.push({
                name: paramName,
                required: !fullMatch.endsWith('?'),
                type: this.guessParamType(paramName)
            });
        }
        
        return params;
    }

    /**
     * Devine le type d'un paramètre basé sur son nom
     */
    guessParamType(paramName) {
        const name = paramName.toLowerCase();
        
        if (name.includes('uuid')) return 'uuid';
        if (name.includes('id')) return 'id';
        if (name === 'code') return 'code';
        if (name === 'nom') return 'nom';
        if (name === 'commune') return 'commune';
        if (name === 'mode') return 'mode';
        if (name === 'type') return 'type';
        if (name === 'option') return 'option';
        if (name === 'list') return 'list';
        if (name === 'section') return 'section';
        if (name === 'cd_type') return 'cd_type';
        if (name === 'ref_id') return 'ref_id';
        
        return 'default';
    }

    /**
     * Évalue la criticité d'une route
     */
    assessCriticality(pattern, method) {
        // Routes critiques
        if (pattern.includes('auth') || pattern.includes('login')) return 'CRITICAL';
        if (pattern.includes('selectors') || pattern.includes('criteria')) return 'HIGH';
        if (pattern.includes('uuid=') && method === 'GET') return 'MEDIUM';
        if (method === 'GET') return 'LOW';
        if (method === 'POST' || method === 'PUT' || method === 'DELETE') return 'SKIP'; // On évite les modifications
        
        return 'LOW';
    }

    /**
     * Détermine si une route est testable automatiquement
     */
    isTestable(pattern, method) {
        // D'abord vérifier si la route est configurée et activée
        const config = this.routesConfig.routes && this.routesConfig.routes[pattern];
        if (config && config.enabled) {
            this.log('debug', `✅ Route testable via config: ${pattern}`);
            return true;
        }
        
        // Skip les routes de modification
        if (['POST', 'PUT', 'DELETE'].includes(method.toUpperCase())) return false;
        
        // Skip les routes de fichiers/upload
        if (pattern.includes('upload') || pattern.includes('file')) return false;
        
        // Skip les routes complexes nécessitant des données spécifiques
        if (pattern.includes('gen_fiche_travaux')) return false;
        
        // Skip les routes avec UUID + mode (nécessitent des UUIDs valides de la BDD)
        if (pattern.includes(':uuid') && pattern.includes(':mode')) return false;
        
        // Skip les routes avec des paramètres obligatoires multiples
        if (pattern.includes(':uuid') && (
            pattern.includes('uuid=:uuid') || // Format uuid=:uuid 
            pattern.includes('/uuid=') ||     // Paramètres avec uuid obligatoire
            pattern.includes('full')          // Mode full nécessite uuid valide
        )) return false;
        
        // Skip les routes avec des combinaisons complexes de paramètres
        if (pattern.match(/:[\w]+.*:[\w]+.*:[\w]+/)) return false; // 3+ paramètres
        
        // Skip les routes spécifiques nécessitant des données métier
        const skipPatterns = [
            '/criteria/',     // Critères spécifiques
            '/selectors',     // Sélecteurs
            '/bilan_exe/',    // Bilans d'exécution
            '/pmfu/',         // PMFU spécifiques
            '/docs/',         // Documentation avec types
            '/foncier/extraction', // Extractions foncières
            'parcelles/commune/', // Parcelles par commune
            '/lizmap/'        // Intégration Lizmap
        ];
        
        if (skipPatterns.some(skip => pattern.includes(skip))) return false;
        
        return true;
    }

    /**
     * Génère une URL de test pour une route avec ses paramètres
     */
    generateTestUrl(route) {
        // Essayer d'abord avec la configuration personnalisée
        const configuredUrl = this.generateConfiguredTestUrl(route);
        if (configuredUrl) {
            return configuredUrl;
        }
        
        // Fallback vers les valeurs par défaut
        let url = route.fullPath;
        
        // Remplacer chaque paramètre par une valeur de test
        route.params.forEach(param => {
            const testValue = TEST_VALUES[param.type] || TEST_VALUES.default;
            const paramPattern = `:${param.name}${param.required ? '' : '?'}`;
            url = url.replace(paramPattern, testValue);
        });
        
        // Nettoyer les caractères spéciaux restants
        url = url.replace(/\*/g, '*'); // Garder les wildcards
        
        return url;
    }

    /**
     * Découvre automatiquement toutes les routes de l'application
     */
    async discoverRoutes() {
        this.log('info', '🔍 Découverte automatique des routes...');
        this.discoveredRoutes = [];
        
        // Mapping des fichiers de routes et leurs points de montage
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
        
        for (const { file, mount } of routeFiles) {
            const filePath = path.join(CONFIG.ROUTES_DIR, file);
            
            if (fs.existsSync(filePath)) {
                const routes = this.analyzeRouteFile(filePath, mount);
                this.discoveredRoutes.push(...routes);
                this.log('info', `📁 ${file}: ${routes.length} routes découvertes`);
            } else {
                this.log('warn', `📁 Fichier non trouvé: ${filePath}`);
            }
        }
        
        // Filtrer les routes testables
        const testableRoutes = this.discoveredRoutes.filter(route => route.testable);
        const filteredRoutes = this.discoveredRoutes.filter(route => !route.testable);
        
        this.stats.routesDiscovered = this.discoveredRoutes.length;
        this.log('info', `🎯 Total: ${this.discoveredRoutes.length} routes découvertes, ${testableRoutes.length} testables`);
        this.log('info', `🚫 Routes filtrées: ${filteredRoutes.length} (nécessitent des paramètres spécifiques)`);
        
        // Grouper par criticité
        const byCriticality = testableRoutes.reduce((acc, route) => {
            acc[route.criticality] = (acc[route.criticality] || 0) + 1;
            return acc;
        }, {});
        
        this.log('info', '📊 Répartition par criticité:', byCriticality);
        
        // Mettre à jour la configuration avec les nouvelles routes découvertes
        this.updateRoutesConfig(this.discoveredRoutes);
        
        return testableRoutes;
    }

    async authenticate() {
        try {
            const response = await axios.post(`${CONFIG.API_BASE_URL}/auth/login`, {
                username: CONFIG.TEST_USERNAME,
                password: CONFIG.TEST_PASSWORD
            }, { timeout: CONFIG.TIMEOUT });

            if (response.data.token) {
                this.token = response.data.token;
                this.log('info', '🔐 Authentification réussie');
                return true;
            } else {
                throw new Error('Pas de token dans la réponse');
            }
        } catch (error) {
            this.log('error', '🔐 Échec authentification', error.message);
            return false;
        }
    }

    async getUserInfo() {
        try {
            const response = await axios.get(`${CONFIG.API_BASE_URL}/auth/me`, {
                headers: { Authorization: `Bearer ${this.token}` },
                timeout: CONFIG.TIMEOUT
            });

            this.userInfo = response.data;
            this.log('info', `👤 Utilisateur connecté: ${this.userInfo.prenom} ${this.userInfo.nom}`);
            return true;
        } catch (error) {
            this.log('error', '👤 Échec récupération utilisateur', error.message);
            return false;
        }
    }

    async testRoute(route) {
        const testUrl = this.generateTestUrl(route);
        const fullUrl = `${CONFIG.API_BASE_URL}${testUrl}`;
        
        try {
            const startTime = Date.now();
            const response = await axios.get(fullUrl, {
                headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
                timeout: CONFIG.TIMEOUT,
                validateStatus: (status) => status < 500 // Accepter les 404 comme "normaux"
            });
            const responseTime = Date.now() - startTime;

            let itemCount = 'N/A';
            let isValid = response.status === 200;

            // Analyser la réponse
            if (response.data) {
                if (Array.isArray(response.data)) {
                    itemCount = response.data.length;
                } else if (response.data.features && Array.isArray(response.data.features)) {
                    itemCount = response.data.features.length;
                } else if (typeof response.data === 'object') {
                    itemCount = 'Object';
                }
            }

            const result = {
                success: isValid,
                status: response.status,
                responseTime,
                itemCount,
                url: testUrl,
                criticality: route.criticality
            };

            if (isValid) {
                this.log('info', `✅ ${route.fullPath} (${route.criticality}): OK (${responseTime}ms, ${itemCount} items)`);
            } else if (response.status === 404) {
                this.log('warn', `⚠️  ${route.fullPath} (${route.criticality}): 404 - Route ou paramètres non valides`);
                result.success = true; // 404 peut être normal pour certaines routes avec des paramètres fictifs
            } else {
                this.log('error', `❌ ${route.fullPath} (${route.criticality}): Status ${response.status}`);
            }

            return result;
        } catch (error) {
            this.log('error', `❌ ${route.fullPath} (${route.criticality}): ÉCHEC`, error.message);
            return {
                success: false,
                error: error.message,
                url: testUrl,
                criticality: route.criticality
            };
        }
    }

    async runAutoHealthCheck() {
        this.log('info', '🤖 === DÉBUT AUTO HEALTH CHECK ===');
        this.stats.totalChecks++;
        this.stats.lastCheck = new Date();

        const results = {
            timestamp: new Date().toISOString(),
            success: true,
            checks: {},
            summary: {}
        };

        // 1. Authentification
        if (!await this.authenticate()) {
            results.success = false;
            results.checks.auth = { success: false, error: 'Authentification échouée' };
            await this.handleFailure('🔐 **ÉCHEC AUTHENTIFICATION AUTO**\nImpossible de se connecter à l\'API');
            return results;
        }
        results.checks.auth = { success: true };

        // 2. Info utilisateur
        if (!await this.getUserInfo()) {
            results.success = false;
            results.checks.userInfo = { success: false, error: 'Récupération utilisateur échouée' };
        } else {
            results.checks.userInfo = { success: true, user: this.userInfo };
        }

        // 3. Découverte des routes
        const testableRoutes = await this.discoverRoutes();
        
        // 4. Test des routes par ordre de criticité
        const routesByPriority = testableRoutes.sort((a, b) => {
            const priority = { 'CRITICAL': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
            return (priority[b.criticality] || 0) - (priority[a.criticality] || 0);
        });

        let successCount = 0;
        let failureCount = 0;

        for (const route of routesByPriority) {
            const result = await this.testRoute(route);
            results.checks[`${route.method} ${route.fullPath}`] = result;
            
            if (result.success) {
                successCount++;
            } else {
                failureCount++;
                if (route.criticality === 'CRITICAL' || route.criticality === 'HIGH') {
                    results.success = false;
                }
            }
            
            this.stats.routesTested++;
        }

        // 5. Résumé
        results.summary = {
            routesDiscovered: this.stats.routesDiscovered,
            routesTested: this.stats.routesTested,
            successes: successCount,
            failures: failureCount,
            successRate: Math.round((successCount / (successCount + failureCount)) * 100)
        };

        // 6. Résultats finaux
        if (results.success) {
            this.stats.lastSuccess = new Date();
            this.stats.consecutiveFailures = 0;
            this.log('info', `🎉 AUTO HEALTH CHECK: ${results.summary.successRate}% réussite (${successCount}/${successCount + failureCount})`);
            
            if (this.stats.consecutiveFailures > 0) {
                await this.sendTelegramNotification(`🎉 **API AUTO RÉCUPÉRÉE**\n${results.summary.successRate}% des routes testées avec succès !`);
            }
        } else {
            await this.handleFailure(`🚨 **PROBLÈMES DÉTECTÉS (AUTO)**\nRoutes critiques en échec !\n\n📊 Taux de réussite: ${results.summary.successRate}%\n🔍 Routes testées: ${results.summary.routesTested}`);
        }

        this.log('info', '🤖 === FIN AUTO HEALTH CHECK ===\n');
        return results;
    }

    async handleFailure(message) {
        this.stats.failures++;
        this.stats.consecutiveFailures++;
        
        if (this.stats.consecutiveFailures === 1 || this.stats.consecutiveFailures % 10 === 0) {
            const detailedMessage = `${message}\n\n📊 **Statistiques AUTO:**\n- Échecs consécutifs: ${this.stats.consecutiveFailures}\n- Total vérifications: ${this.stats.totalChecks}\n- Routes découvertes: ${this.stats.routesDiscovered}\n- Dernière réussite: ${this.stats.lastSuccess ? this.stats.lastSuccess.toLocaleString('fr-FR') : 'Jamais'}`;
            await this.sendTelegramNotification(detailedMessage, true);
        }
    }

    async start() {
        this.log('info', '🚀 Démarrage du Auto Health Checker CENCA');
        await this.sendTelegramNotification('🤖 **Monitoring AUTO démarré**\nDécouverte et surveillance automatique de toutes les routes !');

        // Premier check immédiat
        await this.runAutoHealthCheck();

        // Puis checks périodiques
        setInterval(async () => {
            await this.runAutoHealthCheck();
        }, CONFIG.CHECK_INTERVAL);

        this.log('info', `⏰ Vérifications automatiques programmées toutes les ${CONFIG.CHECK_INTERVAL / 1000} secondes`);
    }
}

// Gestion des signaux pour arrêt propre
process.on('SIGINT', async () => {
    console.log('\n🛑 Arrêt du monitoring automatique...');
    const checker = new AutoHealthChecker();
    await checker.sendTelegramNotification('🛑 **Monitoring AUTO arrêté**\nSurveillance automatique des routes interrompue');
    process.exit(0);
});

// Démarrer le service
if (require.main === module) {
    const checker = new AutoHealthChecker();
    checker.start().catch(console.error);
}

module.exports = AutoHealthChecker;