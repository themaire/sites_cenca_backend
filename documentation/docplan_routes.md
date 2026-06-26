# Routes backend — Documents planificateurs (docplan)

Date d'implémentation : 2026-06-24

## Contexte

Ajout des routes Express nécessaires à la gestion des documents planificateurs (plans de gestion) dans le module Angular correspondant. Les données sont stockées dans le schéma PostgreSQL `docplan`.

---

## Tables concernées

| Table | Schéma | Clé primaire | Description |
|---|---|---|---|
| `documents` | `docplan` | `uuid_doc` (varchar) | Document planificateur |
| `unites_gestion` | `docplan` | `uuid_ug` (varchar) | Unités de gestion liées à un document |
| `typ_documents` | `docplan` | `cd_type` | Référentiel des types de documents |

Vue existante utilisée : `docplan.docplanifsites` (liste des docs par site, route `/pgestion/uuid=:uuid_site` inchangée).

---

## Fichiers modifiés

### 1. `fonctions/querys.js`

Ajout de `documents` et `unites_gestion` dans la fonction `getRightId()` qui résout la clé primaire d'une table pour les requêtes UPDATE dynamiques.

```js
} else if (table == 'documents') {
    pkName = 'uuid_doc';
} else if (table == 'unites_gestion') {
    pkName = 'uuid_ug';
}
```

Sans cette modification, `generateUpdateQuery("docplan.documents", ...)` aurait généré une clause `WHERE document = $1` incorrecte (fallback `table.slice(0, -1)`).

---

### 2. `routes/sites/getSitesRoutes.js`

#### Nouvelle route — Fiche complète d'un document

```
GET /sites/pgestion/doc/uuid=:uuid_doc
```

- Retourne un **objet unique** (premier résultat), pas un tableau
- SQL : `SELECT uuid_doc, nom, surface, annee_deb, annee_fin, validite, url, site, entite_coherente, typ_document, actuel, evaluation FROM docplan.documents WHERE uuid_doc = $1`

#### Nouvelle route — Unités de gestion d'un document

```
GET /sites/pgestion/doc/uuid=:uuid_doc/ug
```

- Retourne un **tableau** (peut être vide)
- SQL : `SELECT uuid_ug, code, nom, surface, document FROM docplan.unites_gestion WHERE document = $1 ORDER BY code`

#### Ajout dans le handler `selectvalues`

```
GET /sites/selectvalues=docplan.typ_documents
```

- Retourne `[{ cd_type, libelle }, ...]` ordonné par `libelle`
- Ajout dans le bloc SelectFields **et** dans le bloc `where` du handler (les deux sont nécessaires : le bloc `where` écrase sinon avec le défaut `ORDER BY val_tri`)

---

### 3. `routes/sites/putSitesRoutes.js`

#### INSERT — Route générique étendue

```
PUT /sites/put/table=docplan_documents/insert
PUT /sites/put/table=docplan_unites_gestion/insert
```

Le frontend envoie le nom de table avec underscore (`docplan_documents`) car le point est réservé dans les URLs Express. Un objet `DOCPLAN_TABLES` séparé mappe ces noms vers le nom réel PostgreSQL :

```js
const DOCPLAN_TABLES = {
    docplan_documents: "docplan.documents",
    docplan_unites_gestion: "docplan.unites_gestion",
};
```

> Pourquoi ne pas utiliser le `TABLES` existant ? Ce dictionnaire construit le nom complet via `schema + "." + TABLE` — ce qui aurait donné `"docplan.docplan_documents"`. Le mapping explicite évite ce doublon.

#### UPDATE — Nouveau bloc dans la route générique

```
PUT /sites/put/table=docplan_documents/uuid=:uuid
```

Appel direct de `generateUpdateQuery("docplan.documents", UUID, updateData)` — le nom complet de table est passé explicitement.

---

### 4. `routes/sites/deleteSitesRoutes.js`

#### DELETE — Route spécifique avant la route générique

```
DELETE /sites/delete/docplan_unites_gestion/uuid_ug=:uuid_ug
```

SQL : `DELETE FROM docplan.unites_gestion WHERE uuid_ug = $1`

Placée **avant** la route générique `DELETE /delete/:table/:uuidName=:id/...` car cette dernière crashe sur `table[1]` (`.split(".")` d'un nom sans point renvoie `undefined`).

---

## Récapitulatif des routes

| Méthode | URL | Fichier | Description |
|---|---|---|---|
| GET | `/sites/pgestion/doc/uuid=:uuid_doc` | `getSitesRoutes.js` | Fiche complète d'un document |
| GET | `/sites/pgestion/doc/uuid=:uuid_doc/ug` | `getSitesRoutes.js` | Unités de gestion d'un document |
| GET | `/sites/selectvalues=docplan.typ_documents` | `getSitesRoutes.js` | Types de documents (select) |
| PUT | `/sites/put/table=docplan_documents/uuid=:uuid` | `putSitesRoutes.js` | Mise à jour d'un document |
| PUT | `/sites/put/table=docplan_documents/insert` | `putSitesRoutes.js` | Création d'un document |
| PUT | `/sites/put/table=docplan_unites_gestion/insert` | `putSitesRoutes.js` | Création d'une unité de gestion |
| DELETE | `/sites/delete/docplan_unites_gestion/uuid_ug=:uuid_ug` | `deleteSitesRoutes.js` | Suppression d'une unité de gestion |

---

## Points d'attention

- Les routes GET `pgestion/doc/...` doivent être déclarées **avant** toute route `pgestion/:param` plus générique pour éviter les conflits de pattern Express (ce n'est pas le cas ici mais c'est une règle à garder en tête).
- La suppression d'un document (`docplan.documents`) n'a pas été implémentée car non demandée. La contrainte `ON DELETE CASCADE` sur `unites_gestion.document` assure que les UG sont supprimées automatiquement si un document est supprimé directement en base.
- Le schéma `docplan` doit être accessible depuis le rôle PostgreSQL utilisé par le pool de connexion (`poolConnect.js`). Si ce n'est pas le cas, ajouter `docplan` au `search_path` de la connexion ou vérifier les permissions.
