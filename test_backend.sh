#!/bin/bash
# Test manuel du backend : connexion (JWT), /auth/me, une opération, et le chatbot /chat.
#
# Prérequis : jq (sudo apt-get install jq)
#
# Usage :
#   ./test_backend.sh                         # dev local : http://localhost:8887
#   BASE_URL=https://192.168.1.50:8889 ./test_backend.sh
#   ./test_backend.sh "Quels sites gère-t-on à Reims ?"   # + question au chatbot
#   ./test_backend.sh --token                 # n'affiche que le token (TOKEN=$(./test_backend.sh --token))
#   ./test_backend.sh --chat                  # conversation en plusieurs tours (/nouveau pour repartir à zéro, Entrée vide pour quitter)
#   CHAT_BRUT=1 ./test_backend.sh "…"            # événements SSE bruts au lieu du texte assemblé
#
# Authentification, dans l'ordre :
#   1. --jeton <token> en premier argument, ou variable TOKEN : ./test_backend.sh --jeton eyJ… --chat
#   2. token en cache (~/.cache/cenca_test_backend_token_<url>, un par backend), réutilisé tant qu'il est accepté
#   3. identifiants : variables API_USER / API_PASSWORD, sinon demandés au clavier (mot de passe masqué)
#   --oublier supprime le token en cache (pour changer de compte).

BASE_URL=${BASE_URL:-http://localhost:8887}
# Certificat Let's Encrypt émis pour le nom de domaine : en https sur une IP, ne pas vérifier le certificat
CURL_OPTS=(-s)
[[ $BASE_URL == https://* ]] && CURL_OPTS+=(-k)

if [[ $1 == --jeton ]]; then TOKEN=$2; shift 2; fi
if [[ $1 == --oublier ]]; then OUBLIER=1; shift; fi
if [[ $1 == --token ]]; then SEUL_TOKEN=1; shift; fi
if [[ $1 == --chat ]]; then MODE_CHAT=1; shift; fi
QUESTION=$1

# Messages vers stderr pour garder stdout propre avec --token
info() { echo "$@" >&2; }

# Token en cache, propre à l'URL du backend (dev et prod ont des comptes distincts)
CACHE_TOKEN="${XDG_CACHE_HOME:-$HOME/.cache}/cenca_test_backend_token_$(echo "$BASE_URL" | tr -c 'A-Za-z0-9' '_')"
[[ -n $OUBLIER ]] && rm -f "$CACHE_TOKEN"

# Token accepté par le backend ? (HTTP 200 sur /auth/me)
token_valide() {
    [[ -n $1 ]] && [[ $(curl "${CURL_OPTS[@]}" -o /dev/null -w '%{http_code}' "$BASE_URL/auth/me" -H "Authorization: Bearer $1") == 200 ]]
}

token=""
if [[ -n $TOKEN ]]; then
    token_valide "$TOKEN" || { info "Le token fourni est refusé (expiré ?) : $BASE_URL/auth/me"; exit 1; }
    token=$TOKEN
    info "Connexion : token fourni"
elif [[ -s $CACHE_TOKEN ]] && token_valide "$(cat "$CACHE_TOKEN")"; then
    token=$(cat "$CACHE_TOKEN")
    info "Connexion : token en cache ($CACHE_TOKEN)"
fi

if [[ -z $token ]]; then
    if [[ -z $API_USER ]]; then read -rp "Identifiant : " API_USER; fi
    if [[ -z $API_PASSWORD ]]; then read -rsp "Mot de passe : " API_PASSWORD; echo >&2; fi

    ### LOGIN
    login_json=$(jq -n --arg u "$API_USER" --arg p "$API_PASSWORD" '{username: $u, password: $p}')
    reponse=$(curl "${CURL_OPTS[@]}" -X POST "$BASE_URL/auth/login" -H 'Content-Type: application/json' -d "$login_json")
    token=$(echo "$reponse" | jq -r '.token // empty' 2>/dev/null)

    if [[ -z $token ]]; then
        info "Échec de la connexion sur $BASE_URL/auth/login :"
        info "${reponse:-(pas de réponse : serveur arrêté ou mauvaise URL ?)}"
        exit 1
    fi
    # Cache lisible par soi seul
    mkdir -p "$(dirname "$CACHE_TOKEN")" && (umask 077 && echo "$token" > "$CACHE_TOKEN")
    info "Connexion : $(echo "$reponse" | jq -r '.message') (token valable 1 h, mis en cache)"
fi

if [[ -n $SEUL_TOKEN ]]; then echo "$token"; exit 0; fi

### Infos de connexion
me=$(curl "${CURL_OPTS[@]}" "$BASE_URL/auth/me" -H "Authorization: Bearer $token")
info "Bienvenue $(echo "$me" | jq -r '"\(.prenom) \(.nom) (\(.identifiant), groupe \(.gro_id))"')."

### Infos d'une opération (sauf quand on interroge le chatbot)
if [[ -z $QUESTION && -z $MODE_CHAT ]]; then
ope=$(curl "${CURL_OPTS[@]}" "$BASE_URL/sites/operations/uuid=000A5D57-648A-4AE4-94EF-E0BE43BF9B9a/full" -H "Authorization: Bearer $token")
info "Opération test : $(echo "$ope" | jq -c '.' 2>/dev/null | cut -c1-200)"
fi

### Chatbot : flux SSE assemblé au fil de l'eau (CHAT_BRUT=1 pour voir les événements bruts)
REPONSE=$(mktemp)    # texte de la dernière réponse, pour l'historique en mode --chat
ECHEC=$(mktemp)      # non vide si la dernière question a échoué (erreur, 413, 429…)
trap 'rm -f "$REPONSE" "$ECHEC"' EXIT

# $1 = historique JSON [{role, content}, …] dont le dernier message vient de l'utilisateur
demander() {
    local chat_json evenement="" ligne donnees
    chat_json=$(jq -n --argjson m "$1" '{messages: $m}')
    : > "$REPONSE"; : > "$ECHEC"
    flux() {
        curl "${CURL_OPTS[@]}" -N -X POST "$BASE_URL/chat" \
            -H "Authorization: Bearer $token" \
            -H 'Content-Type: application/json' \
            -d "$chat_json"
    }
    if [[ -n $CHAT_BRUT ]]; then flux; echo; return; fi

    while IFS= read -r ligne; do
        case $ligne in
            "event: "*) evenement=${ligne#event: } ;;
            "{"*) echo "$ligne" | jq -r '"❌ \(.message)"'; echo 1 > "$ECHEC" ;;   # refus hors flux (400, 413, 429…)
            "data: "*)
                donnees=${ligne#data: }
                case $evenement in
                    texte)  echo "$donnees" | jq -j '.texte' | tee -a "$REPONSE" ;;
                    outil)  echo "$donnees" | jq -r '"🔧 \(.nom) \(.arguments | tojson)"' ;;
                    attente) echo "$donnees" | jq -r '"⏳ \(.message)"' ;;
                    fin)    echo; echo "$donnees" | jq -r '"\n✅ \((.duree_ms / 1000 * 10 | round) / 10) s, \(.modele), outils : \(.outils | join(", ") | if . == "" then "aucun" else . end), questions restantes : \(.questions_restantes // "?")"' ;;
                    erreur) echo; echo "$donnees" | jq -r '"\n❌ \(.message)"'; echo 1 > "$ECHEC" ;;
                esac ;;
        esac
    done < <(flux)
}

historique='[]'
if [[ -n $QUESTION ]]; then
    info ""
    info "Chatbot : $QUESTION"
    essai=$(jq -n --arg q "$QUESTION" '[{role: "user", content: $q}]')
    demander "$essai"
    # En mode --chat, la question passée en argument ouvre la conversation
    if [[ ! -s $ECHEC && -s $REPONSE ]]; then
        historique=$(echo "$essai" | jq --rawfile r "$REPONSE" '. + [{role: "assistant", content: $r}]')
    fi
fi

if [[ -n $MODE_CHAT ]]; then
    info ""
    info "Conversation avec le chatbot : /nouveau pour repartir à zéro, Entrée vide pour quitter."
    while true; do
        echo
        read -rep "Vous > " question || break
        [[ -z $question ]] && break
        if [[ $question == /nouveau ]]; then historique='[]'; info "Nouvelle conversation."; continue; fi
        essai=$(echo "$historique" | jq --arg q "$question" '. + [{role: "user", content: $q}]')
        echo
        demander "$essai"
        # Comme le front : un échange en erreur n'entre pas dans l'historique
        if [[ ! -s $ECHEC && -s $REPONSE ]]; then
            historique=$(echo "$essai" | jq --rawfile r "$REPONSE" '. + [{role: "assistant", content: $r}]')
        fi
    done
fi
