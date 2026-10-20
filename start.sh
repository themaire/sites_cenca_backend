#!/bin/bash

# Script de lancement pour l'application backend Node.js
# Usage: ./start.sh [dev|prod] [options]

# Couleurs pour les messages
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Fonction d'affichage de l'aide
show_help() {
    echo -e "${BLUE}🚀 Script de lancement Backend Node.js${NC}"
    echo ""
    echo -e "${GREEN}Usage:${NC}"
    echo "  ./start.sh dev [options]     - Lance en mode développement"
    echo "  ./start.sh prod [options]    - Lance en mode production"
    echo ""
    echo -e "${GREEN}Options:${NC}"
    echo "  -d, --detach                 - Lance en arrière-plan (mode détaché)"
    echo "  -b, --build                  - Force la reconstruction des images"
    echo "  -r, --restart                - Redémarre les services"
    echo "  -s, --stop                   - Arrête les services"
    echo "  -l, --logs                   - Affiche les logs"
    echo "  -h, --help                   - Affiche cette aide"
    echo ""
    echo -e "${GREEN}Exemples:${NC}"
    echo "  ./start.sh dev               - Lance en dev en mode interactif"
    echo "  ./start.sh prod -d           - Lance en prod en arrière-plan"
    echo "  ./start.sh dev -b            - Lance en dev avec rebuild"
    echo "  ./start.sh prod -r           - Redémarre la prod"
    echo "  ./start.sh dev -s            - Arrête le dev"
    echo "  ./start.sh prod -l           - Affiche les logs de prod"
}

# Vérification des paramètres
if [ $# -eq 0 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
    exit 0
fi

MODE=$1
shift # Supprime le premier paramètre pour traiter les options

# Variables
DETACH=""
BUILD=""
RESTART=false
STOP=false
LOGS=false

# Traitement des options
while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--detach)
            DETACH="-d"
            shift
            ;;
        -b|--build)
            BUILD="--build"
            shift
            ;;
        -r|--restart)
            RESTART=true
            shift
            ;;
        -s|--stop)
            STOP=true
            shift
            ;;
        -l|--logs)
            LOGS=true
            shift
            ;;
        *)
            echo -e "${RED}❌ Option inconnue: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# Fonction pour arrêter les services
stop_services() {
    local mode=$1
    echo -e "${YELLOW}🛑 Arrêt des services en mode $mode...${NC}"
    
    if [ "$mode" = "dev" ]; then
        # En dev, on cherche et tue le processus Node.js s'il existe
        PIDS=$(pgrep -f "node.*node_base_sites.js" || true)
        if [ ! -z "$PIDS" ]; then
            echo -e "${YELLOW}🔪 Arrêt du processus Node.js (PID: $PIDS)${NC}"
            kill $PIDS
        else
            echo -e "${BLUE}ℹ️  Aucun processus Node.js en cours${NC}"
        fi
    elif [ "$mode" = "prod" ]; then
        docker-compose -f docker-compose.yml -f docker-compose.prod.yml down
    fi
    
    echo -e "${GREEN}✅ Services arrêtés${NC}"
}

# Fonction pour afficher les logs
show_logs() {
    local mode=$1
    echo -e "${BLUE}📋 Logs du mode $mode:${NC}"
    
    if [ "$mode" = "dev" ]; then
        echo -e "${YELLOW}ℹ️  En mode dev, les logs s'affichent directement dans le terminal où npm start a été lancé${NC}"
        echo -e "${BLUE}💡 Conseil: Lancez './start.sh dev' pour voir les logs en temps réel${NC}"
    elif [ "$mode" = "prod" ]; then
        docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f node_app
    fi
}

# Fonction pour redémarrer
restart_services() {
    local mode=$1
    echo -e "${YELLOW}🔄 Redémarrage en mode $mode...${NC}"
    
    stop_services $mode
    sleep 2
    start_services $mode
}

# Fonction pour démarrer les services
start_services() {
    local mode=$1
    
    if [ "$mode" = "dev" ]; then
        echo -e "${GREEN}🚀 Lancement en mode DÉVELOPPEMENT${NC}"
        echo -e "${BLUE}📍 Backend accessible en HTTP sur localhost:8887${NC}"
        
        # Vérification que npm est installé
        if ! command -v npm &> /dev/null; then
            echo -e "${RED}❌ npm n'est pas installé${NC}"
            exit 1
        fi
        
        # Vérification du package.json
        if [ ! -f "package.json" ]; then
            echo -e "${RED}❌ package.json non trouvé${NC}"
            exit 1
        fi
        
        echo -e "${BLUE}📦 Installation des dépendances si nécessaire...${NC}"
        npm install
        
        echo -e "${GREEN}🎯 Lancement de npm start...${NC}"
        if [ -n "$DETACH" ]; then
            # Mode détaché: lancer en arrière-plan
            nohup npm start > dev.log 2>&1 &
            echo $! > .dev_pid
            echo -e "${GREEN}✅ Serveur lancé en arrière-plan (PID: $!)${NC}"
            echo -e "${BLUE}📋 Logs disponibles dans: dev.log${NC}"
        else
            # Mode interactif: lancer directement
            npm start
        fi
        
    elif [ "$mode" = "prod" ]; then
        echo -e "${GREEN}🚀 Lancement en mode PRODUCTION${NC}"
        echo -e "${BLUE}📍 Backend accessible en HTTPS sur https://si-10.cen-champagne-ardenne.org:8889${NC}"
        
        # Vérification de l'existence des certificats
        if [ ! -f "/etc/ssl/certs/si-10.cen-champagne-ardenne.org/privkey.pem" ]; then
            echo -e "${RED}❌ Certificats SSL non trouvés dans /etc/ssl/certs/si-10.cen-champagne-ardenne.org/${NC}"
            echo -e "${YELLOW}⚠️  Assurez-vous que les certificats sont présents avant de lancer en production${NC}"
            exit 1
        fi
        
        docker-compose -f docker-compose.yml -f docker-compose.prod.yml up $DETACH $BUILD
        
    else
        echo -e "${RED}❌ Mode invalide: $mode${NC}"
        echo -e "${YELLOW}Utilisez 'dev' ou 'prod'${NC}"
        show_help
        exit 1
    fi
}

# Exécution principale
echo -e "${BLUE}🐳 Docker Compose Backend Manager${NC}"
echo "=================================="

# Gestion des actions
if [ "$STOP" = true ]; then
    stop_services $MODE
elif [ "$LOGS" = true ]; then
    show_logs $MODE
elif [ "$RESTART" = true ]; then
    restart_services $MODE
else
    start_services $MODE
fi

# Affichage d'informations utiles si lancé en mode détaché
if [ -n "$DETACH" ] && [ "$STOP" = false ] && [ "$LOGS" = false ]; then
    echo ""
    echo -e "${GREEN}✅ Services lancés en arrière-plan${NC}"
    if [ "$MODE" = "dev" ]; then
        echo -e "${BLUE}📋 Pour voir les logs: tail -f dev.log${NC}"
        echo -e "${BLUE}🛑 Pour arrêter: ./start.sh dev -s${NC}"
        echo -e "${BLUE}🔄 Pour redémarrer: ./start.sh dev -r${NC}"
    else
        echo -e "${BLUE}📋 Pour voir les logs: ./start.sh $MODE -l${NC}"
        echo -e "${BLUE}🛑 Pour arrêter: ./start.sh $MODE -s${NC}"
        echo -e "${BLUE}🔄 Pour redémarrer: ./start.sh $MODE -r${NC}"
    fi
fi