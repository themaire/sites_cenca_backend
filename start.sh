#!/bin/bash

# Script de lancement pour l'application backend Node.js
# Usage: ./start.sh [dev|prod] [options]
# Redéployer la prod : ./start.sh prod -b -d -r (tests du MCP, build, redémarrage, vérification)
# Documentation complète : documentation/deploiement_start_sh.md

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
    echo "  -d, --detach                 - Lance en arrière-plan (mode détaché) ; en prod, vérifie ensuite chaque service"
    echo "  -b, --build                  - Force la reconstruction des images (prod : tests du MCP puis build, avant tout arrêt)"
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
    echo "  ./start.sh prod -b -d -r     - Redéploie la prod : tests, build, redémarrage, vérification"
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

# Prod avec -b : tests du MCP puis build des images AVANT d'arrêter quoi que ce soit.
# Si un test ou le build échoue, la prod en place continue de tourner.
build_prod() {
    echo -e "${BLUE}🧪 Tests hors ligne du MCP (garde-fous SQL)...${NC}"
    if ! (cd mcp && npm test --silent); then
        echo -e "${RED}❌ Tests du MCP en échec : rien n'est reconstruit, la prod actuelle tourne toujours${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Tests du MCP réussis${NC}"
    echo -e "${BLUE}🔨 Build des images (node_app, surveillance, mcp_sites)...${NC}"
    if ! docker-compose -f docker-compose.yml -f docker-compose.prod.yml build; then
        echo -e "${RED}❌ Build en échec : la prod actuelle tourne toujours${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Images construites${NC}"
    BUILD="" # déjà fait : up ne reconstruit pas une seconde fois
}

# Prod en mode détaché : attend que chaque conteneur soit démarré (et « healthy » s'il a un healthcheck,
# comme mcp_sites), puis que le backend réponde en HTTPS. Échec = code de sortie 1 et derniers logs.
DELAI_VERIFICATION=90
verifier_prod() {
    echo -e "${BLUE}🩺 Vérification des services (${DELAI_VERIFICATION} s max)...${NC}"
    local debut=$SECONDS ids id nom etat sante ok
    ids=$(docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps -q)
    while (( SECONDS - debut < DELAI_VERIFICATION )); do
        ok=true
        for id in $ids; do
            etat=$(docker inspect -f '{{.State.Status}}' "$id" 2>/dev/null)
            sante=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null)
            if [ "$etat" != "running" ] || { [ -n "$sante" ] && [ "$sante" != "healthy" ]; }; then ok=false; fi
        done
        [ "$ok" = true ] && break
        sleep 3
    done

    local echec=false
    for id in $ids; do
        nom=$(docker inspect -f '{{.Name}}' "$id" | sed 's#^/##')
        etat=$(docker inspect -f '{{.State.Status}}' "$id")
        sante=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id")
        if [ "$etat" = "running" ] && { [ -z "$sante" ] || [ "$sante" = "healthy" ]; }; then
            echo -e "${GREEN}✅ $nom : $etat${sante:+ ($sante)}${NC}"
        else
            echo -e "${RED}❌ $nom : $etat${sante:+ ($sante)}. Dernières lignes de log :${NC}"
            docker logs --tail 20 "$id" 2>&1
            echec=true
        fi
    done

    # Le backend écoute-t-il en HTTPS ? N'importe quel code HTTP suffit (000 = pas de réponse)
    local code
    for _ in $(seq 10); do
        code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 https://127.0.0.1:8889/ 2>/dev/null)
        [ "$code" != "000" ] && break
        sleep 3
    done
    if [ "$code" != "000" ]; then
        echo -e "${GREEN}✅ Backend : répond en HTTPS sur le port 8889 (HTTP $code)${NC}"
    else
        echo -e "${RED}❌ Backend : aucune réponse HTTPS sur le port 8889${NC}"
        echec=true
    fi

    if [ "$echec" = true ]; then
        echo -e "${RED}❌ La prod ne s'est pas relancée correctement${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Prod opérationnelle${NC}"
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

# Prod avec -b : tests + build d'abord, pour ne couper la prod (-r) qu'une fois les images prêtes
if [ "$MODE" = "prod" ] && [ -n "$BUILD" ] && [ "$STOP" = false ] && [ "$LOGS" = false ]; then
    build_prod
fi

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
        verifier_prod
        echo -e "${BLUE}📋 Pour voir les logs: ./start.sh $MODE -l${NC}"
        echo -e "${BLUE}🛑 Pour arrêter: ./start.sh $MODE -s${NC}"
        echo -e "${BLUE}🔄 Pour redémarrer: ./start.sh $MODE -r${NC}"
    fi
fi