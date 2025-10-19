# 🔍 Système de Surveillance CENCA

## Vue d'ensemble

Système de surveillance automatique et intelligent pour l'API CENCA, conçu pour tester les routes configurées avec leurs paramètres spécifiques.

## Fonctionnalités

### ✨ Fonctionnalités principales
- **Test automatique** des routes configurées dans `routes-config.json`
- **Authentification JWT** avec renouvellement automatique (55 min)
- **Notifications Telegram** intelligentes en cas de problème
- **Configuration flexible** pour chaque route avec paramètres personnalisés
- **Surveillance périodique** configurable (défaut: 5 minutes)

### 🎯 Routes actuellement configurées
- `/sites/criteria/:type/:code/:nom/:commune/:milnat/:resp` ✅ **ACTIVÉE**
  - Paramètres de test configurés
  - Route de recherche multicritères prioritaire

## Installation et Démarrage

### 1. Prérequis
- Docker et Docker Compose installés
- Fichier `.env` configuré dans le répertoire parent
- Réseau Docker `app-network` existant
- Service `node_app` en cours d'exécution

### 2. Variables d'environnement requises
```bash
# Dans le fichier ../.env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
MONITORING_USERNAME=nelie
MONITORING_PASSWORD=password
MONITORING_API_URL=http://node_app:8887
```

### 3. Démarrage rapide
```bash
# Démarrer la surveillance
./start.sh

# Ou manuellement
docker-compose up -d

# Suivre les logs
docker-compose logs -f surveillance
```

## Configuration

### Fichier `routes-config.json`

Structure de configuration pour chaque route :

```json
{
  "/chemin/route/:param": {
    "method": "GET",
    "file": "fichier_source.js",
    "enabled": true,              // Activer/désactiver la route
    "parameters": {
      "param": "valeur_test"      // Paramètres pour les tests
    },
    "priority": "HIGH",           // HIGH/MEDIUM/LOW
    "note": "Description"
  }
}
```

### Activation d'une route

Pour activer une route dans la surveillance :

1. Ouvrir `routes-config.json`
2. Trouver la route désirée
3. Mettre `"enabled": true`
4. Configurer les `parameters` nécessaires
5. Redémarrer : `docker-compose restart surveillance`

## Surveillance et Monitoring

### 📊 Métriques
- **Taux de réussite** calculé en temps réel
- **Temps de réponse** pour chaque route
- **Statistiques** cumulées des tests

### 📱 Notifications Telegram
- **Alertes automatiques** si taux de réussite < 100%
- **Rapports périodiques** de statut
- **Messages formatés** avec emojis et détails

### 🔐 Gestion des tokens
- **Authentification automatique** au démarrage
- **Renouvellement préventif** (55 minutes)
- **Gestion des erreurs** d'authentification

## Commandes utiles

```bash
# Voir les logs en temps réel
docker-compose logs -f surveillance

# Redémarrer après modification config
docker-compose restart surveillance

# Vérifier le statut
docker-compose ps

# Arrêter la surveillance
docker-compose down

# Reconstruire après modifications code
docker-compose build --no-cache surveillance
```

## Architecture

```
surveillance/
├── surveillance.js          # Application principale
├── routes-config.json      # Configuration des routes
├── package.json           # Dépendances Node.js
├── Dockerfile             # Image Docker
├── docker-compose.yml     # Orchestration
├── start.sh               # Script de démarrage
└── README.md              # Cette documentation
```

## Exemples de logs

```
[2024-01-15T10:15:00.000Z] INFO: 🚀 === DÉMARRAGE SURVEILLANCE CENCA ===
[2024-01-15T10:15:01.000Z] INFO: 🔐 Authentification réussie
[2024-01-15T10:15:02.000Z] INFO: 🎯 1 routes configurées à tester
[2024-01-15T10:15:03.000Z] INFO: ✅ /sites/criteria/ALL/52003/test/test/ALL/ALL: OK (234ms, 15 items)
[2024-01-15T10:15:03.000Z] INFO: 📊 Résultats: 1/1 (100%)
[2024-01-15T10:15:03.000Z] INFO: 🚀 === FIN SURVEILLANCE ===
```

## Dépannage

### Problèmes courants

**Service ne démarre pas :**
- Vérifier que le réseau `app-network` existe
- S'assurer que `node_app` est en cours d'exécution
- Vérifier les permissions du fichier `.env`

**Routes en échec :**
- Vérifier les paramètres dans `routes-config.json`
- S'assurer que les valeurs correspondent aux données en base
- Vérifier les logs du service principal `node_app`

**Pas de notifications Telegram :**
- Vérifier `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID`
- S'assurer que le bot est ajouté au chat
- Vérifier la connexion internet du conteneur

### Debug avancé

```bash
# Entrer dans le conteneur
docker-compose exec surveillance sh

# Tester la configuration
node -e "console.log(require('./surveillance/routes-config.json'))"

# Vérifier les variables d'environnement
docker-compose exec surveillance env | grep MONITORING
```

## Contribuer

Pour ajouter de nouvelles routes ou fonctionnalités :

1. Modifier `surveillance.js` selon les besoins
2. Mettre à jour `routes-config.json` avec les nouvelles routes
3. Tester avec `docker-compose up --build`
4. Mettre à jour cette documentation

---

💡 **Astuce :** La route `/sites/criteria/:type/:code/:nom/:commune/:milnat/:resp` est déjà configurée et prête à être testée. Il suffit de démarrer la surveillance !