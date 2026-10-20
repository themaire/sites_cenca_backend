# Chatbot « Sonneur » : fonctionnement côté backend

Route `POST /chat` (`routes/chatRoutes.js`), client MCP `fonctions/clientMcp.js`. Le front est décrit dans [`instructions_front_claude_code.md`](instructions_front_claude_code.md).

## Parcours d'une question

1. **Contrôles** : jeton JWT (`401 TOKEN_EXPIRE` s'il a expiré), limite de 20 questions / 5 min par utilisateur (`429`), historique valide et au plus `CHAT_QUESTIONS_MAX` questions (`413`).
2. **Questions d'aide** (« Aide », « Que sais-tu faire ? », « Des exemples ? », « Bonjour »…) : le backend répond directement par la liste `CAPACITES`, sans le modèle, en moins d'une seconde, même quand Sonneur est occupé.
3. **Sonneur occupé** : si tous les serveurs Ollama ont déjà `CHAT_SIMULTANES_MAX` questions en cours, réponse `503` `sonneur_occupe` (voir plus bas).
4. **Flux SSE** ouvert : événements `attente`, `outil`, `texte`, `fin`, `erreur`, et un commentaire `: ping` toutes les 20 s pour qu'aucun proxy ne coupe la connexion pendant la lecture du prompt.
5. **Boucle d'outils** : le modèle (Gemma 4 via Ollama) reçoit le prompt système, l'historique et la liste blanche des outils MCP (`OUTILS_AUTORISES`) ; chaque appel d'outil passe par le serveur MCP (`mcp/`), son résultat est rendu au modèle, jusqu'à la réponse finale.
6. **Fin** : événement `fin` (outils appelés, durée, modèle, questions restantes) et une ligne `[chat]` dans le journal du backend.

## Arrêt de la génération

Quand l'utilisateur clique sur « Arrêter », ferme le panneau ou quitte la page, le front appelle `AbortController.abort()`. La chaîne d'arrêt va jusqu'à Ollama :

1. le front ferme la connexion HTTP ;
2. le backend le détecte (`res.on('close')`), marque la question « interrompue » et déclenche son `AbortController` ;
3. ce signal coupe la requête HTTP vers Ollama **à tout moment, y compris pendant la lecture du prompt**, avant qu'Ollama ait envoyé le moindre en-tête. C'est pour cela que le backend donne son propre signal à `fetch` (`clientOllama`) : le `abort()` de la bibliothèque `ollama-js` ne fonctionne qu'une fois la réponse commencée, soit après plusieurs minutes sur CPU ;
4. Ollama voit la connexion fermée et abandonne la génération ;
5. la place du serveur est libérée (`liberer()`), `GET /chat/etat` repasse à `occupe: false`.

Le même mécanisme s'applique au délai global de `OLLAMA_TIMEOUT_MS` (15 min par défaut : file d'attente, lecture du prompt et génération comprises) : au-delà, la question est abandonnée, Ollama libéré, et le front reçoit `erreur`.

**Vérifié le 2026-10-20** sur le serveur Ollama 192.168.1.26 (CPU, `gemma4:26b`) : une question interrompue après 15 s, en pleine lecture du prompt, est notée « interrompue » à 15,0 s ; une petite requête envoyée à Ollama 1 s plus tard est servie en 25,4 s, comme la même requête sur un Ollama libre (33,7 s). Si Ollama avait poursuivi la question abandonnée, cette requête aurait attendu la fin de la lecture du prompt, environ 5 minutes.

## Sonneur occupé

- Compteur en mémoire par serveur Ollama (`enCours`) ; `CHAT_SIMULTANES_MAX` questions à la fois par serveur (1 par défaut : sur CPU, deux questions simultanées se partagent le processeur et durent deux fois plus).
- `GET /chat/etat` (JWT) : `{ occupe, questions_en_cours, capacite, message }`, interrogé par le front pour bloquer la saisie.
- `POST /chat` quand tout est pris : `503` `{ code: "sonneur_occupe", message }`. Si deux questions arrivent au même instant, la seconde reçoit un événement `erreur` avec le même `code`.
- Chaque question va au serveur joignable le moins chargé (ordre de `OLLAMA_URL` à égalité) et y reste pour tous ses tours d'outils.
- Le compteur est propre à chaque processus backend : le backend de dev et celui de prod ne se voient pas, même s'ils utilisent le même serveur Ollama.

## Garde-fous sur les réponses du modèle

| Problème du modèle | Parade |
|---|---|
| Répond avec des données sans avoir appelé d'outil (inventées) | Texte retenu tant qu'aucun outil n'a servi ; s'il contient des données, relance unique exigeant l'appel d'outil, sinon message d'erreur |
| Refus « réservé aux données des sites » alors qu'un outil a déjà été appelé | Les 120 premiers caractères sont retenus ; refus détecté → non affiché, relance unique |
| Réponse vide | Relance unique, puis erreur |
| S'emballe en écrivant des espaces sans fin (tableaux) | Au-delà de 200 espaces de suite, génération arrêtée et réponse terminée avec une note |
| Liens de site inventés ou mal formés (`(10030)`, `https://domaine/site/10030`) | `reecritureLiens` : seuls les codes / uuid vus dans les résultats d'outils de la question (ou dans les réponses précédentes) restent des liens, ramenés à `/site/<code>` |
| Additions fausses | Totaux calculés côté MCP (ex. `bilan_par_annee_et_action` de `travaux_site`), à recopier sans recalcul |

## Performances sur CPU

Le prompt système, avec la description des outils, est relu entièrement par Ollama dès qu'il change (environ 5 min 30 sur le serveur actuel) ; tant qu'il ne change pas, le cache de préfixe d'Ollama le réutilise et les questions suivantes vont beaucoup plus vite. Toute modification du prompt, des consignes ou des outils refait donc payer la première question. Pour garder les réponses rapides : peu de tours d'outils (outils qui répondent en un appel, comme `travaux_site`), résultats compacts, et capacités hors du prompt (servies par la réponse directe aux questions d'aide).
