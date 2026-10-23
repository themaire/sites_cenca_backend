# Instructions pour Claude Code : menu du header en un seul appel

> À donner en début de session Claude Code dans le dépôt front (`sites_cenca`), par exemple :
> « Lis `instructions_front_menu.md` et remplace le chargement du menu du header ».

## Pourquoi

Aujourd'hui le front construit le menu du header niveau par niveau : `GET menu/parent=null`, puis `GET menu/parent=<id>` pour chaque entrée, puis encore pour les sous-entrées. Pour 30 entrées sur 3 niveaux, cela fait **une trentaine d'appels HTTP**, chacun suivi d'un SELECT en base, à chaque affichage du menu.

Le backend fournit maintenant **tout l'arbre en un seul appel**. Il le garde 10 minutes en mémoire et ne relit donc presque jamais la base.

## Contrat de l'API backend

### `GET {environment.apiBaseUrl}menu/arbre` (public)

Menu complet **sans** l'entrée « Paramètres » (`id` 28). Sert à l'utilisateur non connecté.

### `GET {environment.apiBaseUrl}menu/arbre/admin` (Bearer)

Menu complet **avec** « Paramètres » et ses sous-entrées (Utilisateurs, Droits, Gérer les news).

- En-tête obligatoire : `Authorization: Bearer <token>`. Le token est dans `localStorage.getItem('token')` ; vérifier que l'intercepteur `auth-token.interceptor.ts` l'ajoute bien sur cette URL.
- Sans token : `401 { "message": "Token manquant" }`. Token expiré : `401` avec `code: "TOKEN_EXPIRE"`. Token invalide : `403`.
- Remplace `menu/parent=null/admin` : cette ancienne route reste publique pour la compatibilité, mais elle ne doit plus être utilisée.

### Format de la réponse

Un tableau des entrées de premier niveau, déjà triées. Chaque entrée a **toutes les colonnes** de `gestint.m_menu_header` (les mêmes que les routes `parent=` : `id`, `name`, `class_color`, `parent`, `men_order`, `route`, `accueil`, `url`, `description`, `picture`, `date_added`, `opened`) **plus** un tableau `enfants`, vide pour une feuille.

```json
[
  {
    "id": 1, "name": "Protéger", "class_color": "c-proteger", "parent": null, "men_order": 1, "route": null, "...": "...",
    "enfants": [
      { "id": 11, "name": "Liste des sites", "route": "sites", "accueil": true, "...": "...", "enfants": [] },
      {
        "id": 10, "name": "Stratégie, anim. et veille foncière", "route": "foncier", "...": "...",
        "enfants": [
          { "id": 27, "name": "Projets MFU", "route": "foncier/pmfu", "...": "...", "enfants": [] }
        ]
      }
    ]
  }
]
```

Tri à chaque niveau : `men_order` croissant (entrées sans `men_order` à la fin), puis `id`. C'est le même ordre que les routes `parent=`.

### Cache

- Côté backend : un changement fait à la main dans `gestint.m_menu_header` apparaît au plus tard **10 minutes** après, ou dès le redémarrage du backend.
- Côté navigateur : la réponse porte `Cache-Control: private, max-age=300` et un `ETag`. Le navigateur réutilise donc la réponse 5 minutes sans rien demander, puis reçoit un `304` sans corps tant que rien n'a changé. **Il n'y a rien à coder pour en profiter.**

## Ce qu'il faut changer dans le front

1. Dans le service du menu, remplacer la méthode récursive (appels `menu/parent=…` imbriqués) par **un seul appel**, partagé entre tous les composants grâce à `shareReplay(1)` :

   ```ts
   export interface MenuNoeud {
     id: number;
     name: string;
     class_color: string | null;
     parent: number | null;
     men_order: number | null;
     route: string | null;
     accueil: boolean | null;
     url: string | null;
     description: string | null;
     picture: string | null;
     date_added: string | null;
     opened: boolean | null;
     enfants: MenuNoeud[];
   }

   private menus = new Map<boolean, Observable<MenuNoeud[]>>();

   getMenu(admin: boolean): Observable<MenuNoeud[]> {
     if (!this.menus.has(admin)) {
       const url = `${environment.apiBaseUrl}menu/arbre${admin ? '/admin' : ''}`;
       this.menus.set(admin, this.http.get<MenuNoeud[]>(url).pipe(shareReplay(1)));
     }
     return this.menus.get(admin)!;
   }
   ```

   `admin` vaut `true` dans les cas où le front appelait jusqu'ici `menu/parent=null/admin`. Pour un utilisateur non connecté, appeler la version publique : la version admin lui renverrait une 401.

2. Les templates qui parcouraient les sous-menus chargés à part parcourent maintenant `noeud.enfants`, par exemple `@for (sous of noeud.enfants; track sous.id)`. **Ouvrir un sous-menu ne doit plus déclencher aucune requête.**

3. Les autres usages du menu, comme la page d'accueil qui affiche les entrées `accueil: true`, peuvent réutiliser `getMenu()` et aplatir l'arbre sans nouvel appel :

   ```ts
   const aplatir = (l: MenuNoeud[]): MenuNoeud[] => l.flatMap(n => [n, ...aplatir(n.enfants)]);
   ```

4. À la déconnexion ou au changement d'utilisateur, vider le cache du service (`this.menus.clear()`).

5. Vérifier dans l'onglet Réseau du navigateur qu'**un seul** appel `menu/arbre` part au chargement de l'application, et qu'il n'y en a plus aucun vers `menu/parent=`.

Les anciennes routes `menu/parent=:id/:pref?` et `menu/tokenparent=:id` restent en place côté backend tant que le front les utilise. Elles pourront être supprimées une fois ce changement en production.
