# Instructions pour Claude Code : chatbot dans le front Angular

> À donner en début de session Claude Code dans le dépôt front (`sites_cenca`), par exemple :
> « Lis `instructions_front_claude_code.md` et implémente le chatbot sur une branche `chatbot` ».

## Contexte

L'application Angular des sites du CENCA reçoit un **chatbot métier**. Tout le travail lourd est côté backend Node (branche `chatbot` du dépôt `sites_cenca_backend`).

Le backend fait tourner un LLM local, **Gemma 4 via Ollama**. Ce LLM n'accède aux données qu'à travers des **requêtes métier en lecture seule** du serveur MCP `cenca-sites`. Il ne peut pas écrire de SQL libre.

**Le front ne fait que l'interface de chat.** Il n'appelle jamais Ollama ni le MCP directement : uniquement `POST {apiBaseUrl}chat`.

## Contrat de l'API backend

### `POST {environment.apiBaseUrl}chat`

- En-têtes : `Content-Type: application/json` et `Authorization: Bearer <token>`. Le token se trouve dans `localStorage.getItem('token')`, comme pour l'intercepteur `auth-token.interceptor.ts`.
- Corps : `{ "messages": [ { "role": "user" | "assistant", "content": "..." }, ... ] }`.
  - C'est **tout l'historique** de la conversation : le backend est sans état et c'est le front qui porte la conversation.
  - Le dernier message doit être `user`.
  - Chaque message est tronqué à 4 000 caractères. Une conversation compte au plus **10 questions** (réglable côté backend) : au-delà, ou si l'historique dépasse 30 000 caractères, le backend répond `413` (voir ci-dessous).
- Réponses d'erreur JSON (hors flux) :

  | Code | Cause |
  |---|---|
  | `400` | historique invalide |
  | `413` | conversation pleine (`code: "conversation_pleine"`) : il faut ouvrir une nouvelle conversation |
  | `401` / `403` | token absent, expiré ou blacklisté |
  | `429` | plus de 20 questions en 5 minutes par utilisateur |

  Le corps vaut `{ message }` (plus `code` pour le `413`).
- Réponse normale : **flux SSE** (`Content-Type: text/event-stream`). Chaque événement a la forme `event: <nom>\ndata: <json>\n\n` :

  | Événement | `data` | Usage |
  |---|---|---|
  | `outil` | `{ "nom": "fiche_site", "arguments": { "site": "10035" } }` | Le modèle lance une requête métier. À afficher discrètement (« Recherche : fiche_site… ») et à conserver pour le dépliant « Requêtes utilisées ». |
  | `attente` | `{ "message": "Le chatbot traite déjà 1 autre question : la réponse prendra plus de temps que d'habitude.", "questions_en_cours": 1 }` | Envoyé au début, seulement si le serveur est déjà occupé. Afficher le message dans la bulle en attente (style discret, italique), et le retirer dès le premier `texte`. |
  | `texte` | `{ "texte": "morceau" }` | Morceau de la réponse en Markdown, à concaténer au fil de l'eau. |
  | `fin` | `{ "outils": ["fiche_site"], "duree_ms": 5321, "modele": "gemma4", "questions_restantes": 7 }` | Fin normale (`modele` = modèle qui a répondu, à afficher discrètement, ex. en infobulle ; `questions_restantes` = questions encore possibles dans cette conversation). |
  | `erreur` | `{ "message": "Aucun serveur Ollama n'est joignable." }` | Fin en erreur, message lisible à afficher. |

- Si on interrompt la requête (`AbortController.abort()`), le backend arrête le modèle. Il faut le faire à la fermeture du panneau et sur « Nouvelle conversation » pendant une génération.

**Attention :** `HttpClient` d'Angular ne sait pas lire un flux SSE en POST. On utilise donc `fetch` et un `ReadableStream`. L'en-tête Bearer doit alors être ajouté à la main, car l'intercepteur ne s'applique pas à `fetch`.

## Ce qu'il faut créer

Conventions du projet à respecter :
- Angular 18 et **composants standalone** (pas de NgModule) ;
- Angular Material, avec les modules partagés dans `src/app/shared/costomMaterial/` ;
- code et commentaires en **français** ;
- styles SCSS qui importent `src/app/styles/variables.scss` et `mixins.scss`.

### 1. `src/app/shared/services/chatbot.service.ts`

Service `providedIn: 'root'` avec une méthode `envoyer(messages, signal): Observable<EvenementChat>`, qui :
- appelle `fetch(environment.apiBaseUrl + 'chat', { method: 'POST', headers, body, signal })` ;
- si `!reponse.ok`, émet une erreur avec `(await reponse.json()).message`, ou un message par défaut selon le statut (401/403 : « Session expirée, reconnectez-vous » ; 429 : trop de questions) ;
- lit `reponse.body.getReader()` avec un `TextDecoder` et découpe les événements SSE sur `\n\n`, sans oublier de garder le reste incomplet dans un tampon ;
- pour chaque événement, lit les lignes `event:` et `data:`, applique `JSON.parse(data)` et émet `{ type, donnees }`.

Types suggérés :

```ts
export interface MessageChat { role: 'user' | 'assistant'; content: string; outils?: AppelOutil[]; erreur?: boolean; }
export interface AppelOutil { nom: string; arguments: Record<string, unknown>; }
export type EvenementChat =
  | { type: 'outil'; donnees: AppelOutil }
  | { type: 'attente'; donnees: { message: string; questions_en_cours: number } }
  | { type: 'texte'; donnees: { texte: string } }
  | { type: 'fin'; donnees: { outils: string[]; duree_ms: number; modele: string; questions_restantes: number } }
  | { type: 'erreur'; donnees: { message: string } };
```

Ne pas envoyer au backend les champs `outils` ou `erreur`, ni les messages en erreur : seulement `{ role, content }`.

### 2. `src/app/chatbot/chatbot.component.{ts,html,scss}`

Composant standalone, sélecteur `app-chatbot`.

**Bouton flottant**
- `mat-fab` (icône `chat` ou `forum`) en `position: fixed`, en bas à droite.
- Le bouton existant `back-to-top` (`src/app/back-to-top/`) occupe déjà `bottom: 20px; right: 20px`. Placer le chatbot au-dessus (par exemple `bottom: 80px`) ou décaler l'autre, sans chevauchement.

**Panneau** (environ 400 × 600 px, plein écran sur mobile)
- En-tête : titre « Assistant sites », bouton « Nouvelle conversation », bouton fermer.
- Liste des messages avec défilement automatique vers le bas.
  - Messages utilisateur : texte brut.
  - Messages assistant : **Markdown → HTML** avec `marked`, déjà installé. Reprendre le pattern de `src/app/services/documentation.service.ts`, rendre via `[innerHTML]` (assaini par Angular) et styler les tableaux.
- Pendant la génération :
  - indicateur (`mat-progress-bar` ou trois points) ;
  - libellé de l'outil en cours, par exemple « Consultation : foncier_site… » ;
  - libellés lisibles plutôt que les noms techniques, avec une table de correspondance :

    | Outil | Libellé |
    |---|---|
    | `rechercher_sites` | Recherche de sites |
    | `fiche_site` | Fiche du site |
    | `geometrie_site` | Contour du site |
    | `sites_autour_point` | Sites autour d'un point |
    | `sites_par_commune` | Sites de la commune |
    | `synthese_sites` | Synthèse des sites |
    | `foncier_site` | Maîtrise foncière |
    | `echeances_actes` | Échéances des actes |
    | `rechercher_projets` | Recherche de projets |
    | `operations_projet` | Opérations du projet |
    | `bilan_operations` | Bilan des opérations |

- Sous chaque réponse : un dépliant **« Requêtes utilisées (n) »** (`mat-expansion-panel` ou un simple `<details>`) qui liste chaque outil et ses arguments. C'est ce qui permet de faire confiance à la réponse.
- Zone de saisie (`textarea`) : Entrée envoie, Maj+Entrée fait un retour à la ligne. Bouton envoyer désactivé pendant la génération, avec un bouton « Stop » à la place qui interrompt la requête.
- Message d'accueil avec 3 exemples cliquables, plus un lien « Que sais-tu faire ? » qui envoie cette question (le chatbot répond par la liste de ses capacités, sans interroger la base) :
  - « Quels actes fonciers arrivent à échéance dans les 6 mois ? »
  - « Quels sont les nouveaux sites de 2025 dans l'Aube ? »
  - « Quels sont les plus grands sites d'Aurore ? »
- Erreurs : afficher le message dans la bulle en style d'erreur, et ne pas l'inclure dans l'historique renvoyé ensuite.
- Limite de conversation, d'après `questions_restantes` du dernier `fin` :
  - 1 ou 2 : bandeau discret au-dessus de la saisie, « Plus que N question(s) dans cette conversation » ;
  - 0 : saisie désactivée, avec le message « Conversation terminée : ouvrez une nouvelle conversation pour continuer » et un bouton « Nouvelle conversation » bien visible ;
  - un `413` (cas d'un historique trop volumineux) se traite pareil : message du backend + bouton « Nouvelle conversation ».
- Le chatbot refuse en une phrase les questions hors du périmètre des sites du CENCA : rien de spécial à faire côté front.
- Historique : en mémoire dans le composant, sauvegardé dans `sessionStorage` (clé `chatbot_historique`, avec `try/catch`) pour survivre à la navigation. « Nouvelle conversation » le vide.
- Mention discrète en pied de panneau : « Assistant IA local, lecture seule : vérifiez les informations importantes. »

### 3. `src/app/app.component.{ts,html}`

- Importer `ChatbotComponent` dans `AppComponent`.
- Dans `app.component.html`, ajouter `<app-chatbot>` après `<app-footer>`. Ne l'afficher que si l'utilisateur est connecté (`token` présent) **et** hors des routes publiques (`/aide`, `/documentation`, `/login`, `/reset-password`, `/not-found`).
- Le `publicRoutes` est dupliqué dans `ngOnInit` et `checkToken` : on peut en faire une constante de classe au passage.

## Vérification

1. Prérequis : le backend de la branche `chatbot` tourne (`npm start`, port 8887) avec `OLLAMA_URL`, `OLLAMA_MODEL`, `MCP_URL` et `MCP_API_TOKEN` renseignés dans son `.env`.
2. Lancer `ng serve`, se connecter et ouvrir le chatbot.
3. Poser les 3 questions d'exemple. Vérifier que :
   - le texte arrive au fil de l'eau ;
   - les libellés d'outils s'affichent pendant la recherche ;
   - les tableaux Markdown sont bien rendus ;
   - le dépliant « Requêtes utilisées » est rempli.
4. Poser une question de suivi (« et pour le premier ? ») : l'historique doit être bien transmis.
5. Enchaîner les questions jusqu'à la limite : bandeau à 2 et 1 question restante, saisie bloquée à 0, « Nouvelle conversation » repart de zéro.
6. Poser une question hors sujet (« Donne-moi une recette de tarte ») : refus en une phrase.
7. Cliquer sur « Stop » pendant une génération : la requête est annulée, sans erreur en console.
8. Se déconnecter : le bouton disparaît. Expirer le token : le message « Session expirée » s'affiche.
9. Vérifier l'affichage mobile et le non-chevauchement avec `back-to-top`.
10. `ng build` sans erreur.
