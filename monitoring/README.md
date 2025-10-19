# 🏥 Health Check Service - API CENCA

Un service de monitoring automatisé pour surveiller la santé de l'API CENCA avec notifications Telegram en temps réel.

## 🎯 Fonctionnalités

### 🔍 **Surveillance complète**
- **Authentification** : Test de connexion et récupération du token JWT
- **Routes critiques** : Vérification des endpoints essentiels
- **API externes** : Monitoring des services géographiques (Lizmap, IGN)
- **Performance** : Mesure des temps de réponse
- **Validation** : Contrôle du nombre d'éléments retournés

### 📱 **Notifications intelligentes**
- **Telegram Bot** : Alertes instantanées en cas de problème
- **Notifications de récupération** : Confirmation quand tout redevient normal
- **Limitation** : Évite le spam (1ère erreur + toutes les 10 erreurs)

### ⏰ **Monitoring automatique**
- **Intervalle configurable** : Vérifications toutes les 5 minutes par défaut
- **Démarrage immédiat** : Premier check au lancement
- **Arrêt propre** : Notification d'arrêt sur SIGINT

## 🚀 Configuration

### Variables d'environnement

Les variables sont définies dans le fichier `.env` principal du projet :

```env
# Configuration du monitoring - URL de l'API à surveiller
MONITORING_API_URL=http://node_app:8887

# Configuration du compte utilisé pour les tests
MONITORING_USERNAME=nelie
MONITORING_PASSWORD=TgvTgmTgv10!

# Configuration Telegram
TELEGRAM_BOT_TOKEN=362638108:AAEuTVjhD1_-5rCsmc3jLRNDOrvFmWAlfTI
TELEGRAM_CHAT_ID=475031476

# Optionnel - Configuration avancée
MONITORING_INTERVAL=300000  # 5 minutes en millisecondes
MONITORING_TIMEOUT=10000    # 10 secondes de timeout
```

### Docker Compose

Le service est intégré dans `docker-compose.yml` :

```yaml
health-check:
  build: ./monitoring
  environment:
    - MONITORING_API_URL=http://node_app:8887
    - MONITORING_USERNAME=${MONITORING_USERNAME:-nelie}
    - MONITORING_PASSWORD=${MONITORING_PASSWORD:-password}
    - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
    - TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
    - MONITORING_INTERVAL=${MONITORING_INTERVAL:-300000}
    - MONITORING_TIMEOUT=${MONITORING_TIMEOUT:-10000}
    - NODE_TLS_REJECT_UNAUTHORIZED=0
  depends_on:
    - node_app
  networks:
    - monitoring
  restart: unless-stopped
  volumes:
    - ./monitoring/logs:/app/logs
    - /etc/ssl/certs/si-10.cen-champagne-ardenne.org:/etc/ssl/certs/si-10.cen-champagne-ardenne.org:ro
```

## 📋 Routes surveillées

### ✅ **Authentification**
- `/auth/login` - Connexion utilisateur
- `/auth/me` - Informations utilisateur

### ✅ **Routes principales**
- `/sites/criteria/*/*/*/*/*/*` - Sites par critères (≥1 item)
- `/sites/selectors` - Sélecteurs de recherche (≥5 items)

### ✅ **Routes opérations** 
- `/sites/ope-financeurs/uuid=` - Types de financeurs (≥1 item)
- `/sites/ope-animaux/uuid=` - Types d'animaux (≥1 item)

### ✅ **API géographiques externes**
- `/api-geo/parcelles/bbox` - Parcelles cadastrales IGN (≥0 items)
- `/api-geo/lizmap/layer/cenca_sites` - Sites CENCA Lizmap (≥1 item)

### ✅ **Routes métiers**
- `/sites/selectvalues=ope.actions/1` - Actions disponibles (≥5 items)
- `/sites/selectvalues=admin.salaries/` - Liste des salariés (≥1 item)

## 🛠️ Utilisation

### Démarrage

```bash
# Démarrer en mode production avec rebuild
./start.sh prod -b -d

# Ou manuellement
docker-compose up -d health-check
```

### Vérification des logs

```bash
# Voir les logs en temps réel
docker-compose logs -f health-check

# Utiliser le script dédié (plus pratique)
./check_monitoring.sh

# Voir seulement les erreurs
docker-compose logs health-check | grep ERROR
```

### Arrêt

```bash
# Arrêt propre avec notification
docker-compose stop health-check

# Arrêt de tout l'environnement
./start.sh prod -s
```

## 📊 Exemple de sortie

### ✅ **Check réussi**
```
[2025-10-19T14:57:17.312Z] INFO: 🔍 Testing route: Types financeurs -> http://node_app:8887/sites/ope-financeurs/uuid=
[2025-10-19T14:57:17.343Z] INFO: ✅ Types financeurs: OK (30ms, 18 items)
[2025-10-19T14:57:17.344Z] INFO: 🔍 Testing route: Types animaux -> http://node_app:8887/sites/ope-animaux/uuid=
[2025-10-19T14:57:17.389Z] INFO: ✅ Types animaux: OK (45ms, 6 items)
[2025-10-19T14:57:17.973Z] INFO: 🎉 HEALTH CHECK: TOUT OK !
```

### ❌ **Check échoué**
```
[2025-10-19T14:40:54.567Z] ERROR: ❌ Types financeurs: ÉCHEC
"Request failed with status code 404"
[2025-10-19T14:40:54.417Z] INFO: 🚨 Notification Telegram envoyée
```

## 🔧 Dépannage

### Problèmes courants

#### 1. **Erreur d'authentification**
```
ERROR: 🔐 Échec authentification - "socket hang up"
```
**Solution** : Vérifier que l'API est démarrée et accessible

#### 2. **Erreur SSL/TLS**
```
ERROR: SSL routines:ssl3_get_record:wrong version number
```
**Solution** : Utiliser HTTP en interne (`http://node_app:8887`) et HTTPS en externe

#### 3. **Erreur 404 sur routes spécifiques**
```
ERROR: ❌ Types financeurs: ÉCHEC - "Request failed with status code 404"
```
**Solution** : Vérifier que les routes sont bien définies et l'URL est correcte

#### 4. **Problème de permissions sur les logs**
```
WARNING: Could not write to log file: EACCES: permission denied
```
**Solution** : Les logs console fonctionnent, problème non critique

### Commandes de debug

```bash
# Tester les routes manuellement depuis le conteneur
docker exec -it node_pgsql_health-check_1 sh

# Vérifier la configuration
docker exec node_pgsql_health-check_1 env | grep MONITORING

# Rebuilder en cas de modification
docker-compose up -d --build health-check
```

## 📁 Structure des fichiers

```
monitoring/
├── README.md              # Cette documentation
├── Dockerfile             # Image Docker Alpine + Node.js
├── package.json           # Dépendances (axios, dotenv)
├── health-check.js        # Script principal de monitoring
└── logs/                  # Logs locaux (si permissions OK)
    └── health-check.log
```

## 🏆 Statistiques de monitoring

Le service track automatiquement :
- **Total des vérifications** effectuées
- **Nombre d'échecs** rencontrés
- **Échecs consécutifs** actuels
- **Dernière vérification** réussie
- **Temps de réponse** de chaque route

## 🎖️ Crédits

Développé avec ❤️ par **GitHub Copilot** pour surveiller le "bébé" API CENCA de Nicolas Elie.

---

> 💡 **Tip** : Le monitoring fonctionne 24/7 et vous préviendra immédiatement sur Telegram si quelque chose ne va pas avec votre API !