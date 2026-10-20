#!/bin/bash

# Maintenance du conteneur du serveur MCP « cenca-sites » (service mcp_sites du docker-compose.yml racine)
# Usage : ./mcp/maintenance_mcp.sh <commande> [option]   (depuis n'importe quel dossier)

# Couleurs pour les messages
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SERVICE=mcp_sites
CONTENEUR=cenca_mcp_sites
DOSSIER_MCP=$(cd "$(dirname "$0")" && pwd)
RACINE=$(dirname "$DOSSIER_MCP")
DELAI_SANTE=90   # secondes max pour passer à « healthy » après un (re)démarrage

show_help() {
    echo -e "${BLUE}🛠️  Maintenance du conteneur MCP ($CONTENEUR)${NC}"
    echo ""
    echo -e "${GREEN}Usage:${NC}"
    echo "  ./mcp/maintenance_mcp.sh statut           - État du conteneur, santé, image, test de /health"
    echo "  ./mcp/maintenance_mcp.sh logs [N]         - Suit les logs (N dernières lignes, 100 par défaut)"
    echo "  ./mcp/maintenance_mcp.sh tests            - Tests hors ligne (npm test dans mcp/)"
    echo "  ./mcp/maintenance_mcp.sh reconstruire     - Tests, build de l'image, recréation du conteneur, attente de la santé"
    echo "  ./mcp/maintenance_mcp.sh redemarrer       - Redémarre le conteneur sans le recréer (après une modif du .env : reconstruire)"
    echo "  ./mcp/maintenance_mcp.sh arreter          - Arrête le conteneur"
    echo "  ./mcp/maintenance_mcp.sh demarrer         - Démarre le conteneur"
    echo "  ./mcp/maintenance_mcp.sh outils           - Liste les outils vus par le backend (MCP_URL / MCP_API_TOKEN du .env racine)"
    echo "  ./mcp/maintenance_mcp.sh nettoyer         - Supprime les images Docker orphelines laissées par les reconstructions"
    echo "  ./mcp/maintenance_mcp.sh -h               - Affiche cette aide"
}

compose() {
    (cd "$RACINE" && docker-compose "$@")
}

# Valeur d'une variable de mcp/.env (sans exécuter le fichier)
variable_env() {
    grep -E "^$1=" "$DOSSIER_MCP/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"
}

sante() {
    docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sans healthcheck{{end}}' "$CONTENEUR" 2>/dev/null
}

# Attend que le conteneur soit « healthy » (le healthcheck interroge /health, connexion PostgreSQL comprise)
attendre_sante() {
    echo -e "${BLUE}⏳ Attente de la santé du conteneur (${DELAI_SANTE} s max)...${NC}"
    local debut=$SECONDS etat
    while (( SECONDS - debut < DELAI_SANTE )); do
        etat=$(sante)
        case $etat in
            healthy) echo -e "${GREEN}✅ $CONTENEUR est healthy ($(( SECONDS - debut )) s)${NC}"; return 0 ;;
            unhealthy) break ;;
        esac
        sleep 3
    done
    echo -e "${RED}❌ $CONTENEUR n'est pas healthy (état : ${etat:-absent}). Dernières lignes de log :${NC}"
    docker logs --tail 30 "$CONTENEUR" 2>&1
    return 1
}

statut() {
    if ! docker inspect "$CONTENEUR" >/dev/null 2>&1; then
        echo -e "${RED}❌ Conteneur $CONTENEUR absent. Le créer : ./mcp/maintenance_mcp.sh reconstruire${NC}"
        return 1
    fi
    docker ps -a --filter "name=^${CONTENEUR}$" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.RunningFor}}"
    echo -e "Santé : ${YELLOW}$(sante)${NC}"
    echo "Image construite le : $(docker image inspect -f '{{.Created}}' cenca-mcp-sites:latest 2>/dev/null | cut -c1-19 | tr T ' ')"

    local hote port
    hote=$(variable_env MCP_HOST); hote=${hote:-127.0.0.1}
    port=$(variable_env MCP_PORT); port=${port:-8891}
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$hote:$port/health")
    case $code in
        200) echo -e "${GREEN}✅ /health répond sur http://$hote:$port (PostgreSQL joignable)${NC}" ;;
        403) echo -e "${YELLOW}⚠️  /health refuse cette machine (403) : son adresse n'est pas dans ALLOWED_IPS de mcp/.env${NC}" ;;
        000) echo -e "${RED}❌ /health injoignable sur http://$hote:$port${NC}"; return 1 ;;
        *)   echo -e "${RED}❌ /health répond $code (PostgreSQL injoignable ?)${NC}"; return 1 ;;
    esac
}

tests() {
    echo -e "${BLUE}🧪 Tests hors ligne du MCP...${NC}"
    if (cd "$DOSSIER_MCP" && npm test --silent); then
        echo -e "${GREEN}✅ Tests réussis${NC}"
    else
        echo -e "${RED}❌ Tests en échec : reconstruction annulée${NC}"
        return 1
    fi
}

reconstruire() {
    tests || return 1
    echo -e "${BLUE}🔨 Build de l'image...${NC}"
    compose build "$SERVICE" || { echo -e "${RED}❌ Build en échec : le conteneur actuel tourne toujours${NC}"; return 1; }
    # docker-compose 1.29.2 plante en recréant un conteneur existant (KeyError: 'ContainerConfig') :
    # suppression d'abord, puis création
    echo -e "${BLUE}♻️  Recréation du conteneur...${NC}"
    compose rm -sf "$SERVICE" && compose up -d "$SERVICE" || return 1
    attendre_sante && statut
}

outils() {
    (cd "$RACINE" && node -e '
        require("./fonctions/clientMcp.js").listerOutils()
            .then(o => { console.log(o.length + " outils autorisés pour le chatbot :"); o.forEach(x => console.log("  - " + x.function.name)); })
            .catch(e => { console.error("❌ " + e.message); process.exit(1); })')
}

nettoyer() {
    local images
    images=$(docker images -f dangling=true -q)
    if [ -z "$images" ]; then
        echo -e "${GREEN}Aucune image orpheline.${NC}"
        return 0
    fi
    # Les images orphelines n'ont plus de nom : celles des autres projets Docker de la machine sont concernées aussi
    docker images -f dangling=true
    read -rp "Supprimer ces images orphelines (tous projets confondus) ? [o/N] " reponse
    [[ $reponse == [oO] ]] && docker image prune -f
}

case $1 in
    statut|status)  statut ;;
    logs)           docker logs -f --tail "${2:-100}" "$CONTENEUR" ;;
    tests)          tests ;;
    reconstruire)   reconstruire ;;
    redemarrer)     docker restart "$CONTENEUR" && attendre_sante ;;
    arreter)        compose stop "$SERVICE" ;;
    demarrer)       compose up -d "$SERVICE" && attendre_sante ;;
    outils)         outils ;;
    nettoyer)       nettoyer ;;
    ""|-h|--help)   show_help ;;
    *)              echo -e "${RED}❌ Commande inconnue : $1${NC}"; show_help; exit 1 ;;
esac
