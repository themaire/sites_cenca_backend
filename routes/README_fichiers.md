# Gestion des fichiers (documents et photos)

Ce document décrit le parcours d'un fichier déposé depuis l'application (formulaires
Projets MFU et Travaux) : dépôt, nommage, enregistrement en base, affichage
(vignettes en cache) et suppression.

> Les imports de shapefile / GeoJSON (`/sites/put/...` avec `multerMiddlewareZip` /
> `multerMiddlewareGeoJSON`) et le pipeline foncier (`/process`) sont des traitements
> à part, non décrits ici.

## Vue d'ensemble

```
                  Angular (front)                                   Node / Express                               Stockage
 ┌──────────────────────────────────┐                ┌──────────────────────────────────────┐        ┌────────────────────────────┐
 │ docfile.service submitDocfiles() │── PUT ────────▶│ /sites/put/table=docs                │───────▶│ FILES_DIR/<lib_path>/<nom> │
 │   FormData: ref_id + fichiers    │                │   multer (storagePmfu)               │        │                            │
 │                                  │                │   + INSERT files.docs                │───────▶│ table files.docs           │
 ├──────────────────────────────────┤                ├──────────────────────────────────────┤        ├────────────────────────────┤
 │ getFilesList()                   │── GET ────────▶│ /sites/docs/:section/cd_type=..      │◀───────│ table files.docs           │
 │   -> liste des doc_path          │                │   (getSitesRoutes.js)                │        │                            │
 ├──────────────────────────────────┤                ├──────────────────────────────────────┤        ├────────────────────────────┤
 │ file-explorator getGalerie()     │── GET ────────▶│ /picts/img?file=<doc_path>&width=200 │◀──────▶│ FILES_DIR/cache/<vignette> │
 │   vignettes 200 px               │                │   (pictureRoute.js, sharp)           │        │                            │
 ├──────────────────────────────────┤                ├──────────────────────────────────────┤        ├────────────────────────────┤
 │ image-view / file-explorator     │── GET ────────▶│ /files/<doc_path>  (express.static)  │◀───────│ FILES_DIR/<doc_path>       │
 │   fichier en taille réelle       │                │                                      │        │                            │
 ├──────────────────────────────────┤                ├──────────────────────────────────────┤        ├────────────────────────────┤
 │ deleteFile(doc_path)             │── DELETE ─────▶│ /sites/delete/files.docs?doc_path=   │───────▶│ ligne files.docs           │
 │                                  │                │   (deleteSitesRoutes.js)             │        │ fichier + ses vignettes    │
 └──────────────────────────────────┘                └──────────────────────────────────────┘        └────────────────────────────┘
```

`FILES_DIR` = `/mnt/storage_data/app` (variable `FILES_DIR_ENV` du `.env`).

Toute la logique de **nommage** (fichier déposé et vignette en cache) est centralisée
dans `fonctions/fonctionsFichiers.js`. L'upload, le cache et la suppression doivent
calculer exactement les mêmes noms : ne jamais reconstruire un nom ailleurs.

## Le paramétrage en base : `files.libelles`

Chaque type de document est une ligne de `files.libelles`. C'est elle qui pilote le
nom du champ de formulaire, le dossier de destination et le nombre de fichiers acceptés.

```
files.libelles_nom (famille / objet parent)        files.libelles (type de document)
┌───────────┬────────────┐                          ┌────────┬───────────────────┬──────────────────────┬───────────┬──────────────────┐
│ libnom_id │ libnom_nom │                          │ lib_id │ lib_field         │ lib_path             │ libnom_id │ max_upload_count │
├───────────┼────────────┤                          ├────────┼───────────────────┼──────────────────────┼───────────┼──────────────────┤
│ 1         │ pmfu       │◀─────────────────────────│ 1      │ photoPMFU         │ photos/pmfu          │ 1         │ 10               │
│           │            │◀─────────────────────────│ 2      │ projetActe        │ projets-acte         │ 1         │ 5                │
│           │            │◀─────────────────────────│ 3      │ decisionBureau    │ decision-bureau      │ 1         │ 5                │
│           │            │◀─────────────────────────│ 4      │ noteBureau        │ note-bureau          │ 1         │ 5                │
│ 2         │ site       │◀─────────────────────────│ 5, 6   │ exemple, affichage│ ...                  │ 2         │ 5                │
│ 3         │ travaux    │◀─────────────────────────│ 7      │ photoTravauxAvant │ photos/travaux/avant │ 3         │ 10               │
│           │            │◀─────────────────────────│ 8      │ photoTravauxApres │ photos/travaux/apres │ 3         │ 10               │
└───────────┴────────────┘                          └────────┴───────────────────┴──────────────────────┴───────────┴──────────────────┘
```

- `lib_field` est le **nom du champ** du FormData envoyé par le front ; multer n'accepte que ces champs.
- `lib_path` est le **sous-dossier** de `FILES_DIR` où le fichier est écrit.
- `libnom_id` indique **à quoi se rapporte `ref_id`**, et donc comment nommer le fichier :

| libnom_id | `ref_id` contient                 | Contrôle en base                                  |
|-----------|-----------------------------------|---------------------------------------------------|
| 1 pmfu    | `sitcenca.projets_mfu.pmfu_id`    | trigger `files.check_doc_reference` (doit exister) |
| 3 travaux | `opegerer.projets.uuid_proj`      | aucun pour l'instant                              |

Pour ajouter un nouveau type de document : insérer une ligne dans `files.libelles`.
Le champ multer et le dossier sont pris en compte au prochain dépôt, sans redémarrer le serveur
(`loadMulterFieldsConfig()` et `loadUploadFolders()` sont relus à chaque appel).
Penser aussi à ajouter `files.libelles` à `allowedLists` de `/selectvalues` si besoin (déjà fait).

## 1. Dépôt : `PUT /sites/put/table=docs` (`sites/putSitesRoutes.js`)

```
FormData reçu  : ref_id=d83f4230-...   photoTravauxAvant=<IMG_1234.JPG>   photoTravauxAvant=<Été 2026.jpg>
      │
      ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ loadMulterFieldsConfig()  -> champs acceptés  [{name: lib_field, maxCount}]      │
│ loadUploadFolders()       -> lib_field -> lib_path   et   lib_field -> libnom_id │
└──────────────────────────────────────────────────────────────────────────────────┘
      │
      ▼  multer, pour chaque fichier
┌──────────────────────────────────────────────────────────────────────────────────┐
│ fileFilter   : pdf, doc, docx, jpg, jpeg, png   (sinon 400)                      │
│ destination  : FILES_DIR/<lib_path>   (créé si absent, umask 002)                │
│ filename     : construireNomDocument()  ──────────────▶  voir « Nommage »        │
│                (ref_id absent -> erreur 400)                                     │
└──────────────────────────────────────────────────────────────────────────────────┘
      │
      ▼  pour chaque fichier écrit
┌──────────────────────────────────────────────────────────────────────────────────┐
│ doc_path = chemin relatif à FILES_DIR   ex. photos/travaux/avant/26-10-08_...jpg │
│ chmod 666                                                                        │
│ INSERT files.docs (ref_id, doc_type = lib_id, doc_path)                          │
│   └─ triggers : assign_libnom_id (libnom_id déduit de doc_type)                  │
│                 check_doc_reference (ref_id existant, pour les pmfu)             │
└──────────────────────────────────────────────────────────────────────────────────┘
```

⚠️ `ref_id` doit être ajouté au FormData **avant** les fichiers : multer lit les champs
dans l'ordre, et le nom du fichier en a besoin (`docfile.service.ts` le fait bien).

## 2. Nommage : `construireNomDocument()` (`fonctions/fonctionsFichiers.js`)

```
                  originalname reçu par multer : "Ã\x89tÃ© 2026 (1).JPG"   (UTF-8 lu en latin1)
                                    │
                 nettoyerNomOriginal()
                                    │  1. relecture latin1 -> UTF-8      "Été 2026 (1).JPG"
                                    │  2. extension en minuscules        ".jpg"
                                    │  3. accents retirés                "Ete 2026 (1)"
                                    │  4. hors [A-Za-z0-9_-] -> "-"      "Ete-2026-1"
                                    │  5. 60 caractères maximum
                                    ▼
          ┌──────────── libnom_id du champ ────────────┐
          │                                            │
     3 = travaux                                  autres (pmfu...)
          │                                            │
  code du site :                                       │
  opegerer.projets.uuid_proj = ref_id                  │
    -> projets.site = sites.uuid_site                  │
    -> sitcenca.sites.code                             │
  (ou "sans-site")                                     │
          │                                            │
          ▼                                            ▼
  AA-MM-JJ_<code site>_<nom>.<ext>             AA-MM-JJ_<nom>.<ext>
  26-10-08_10072_Ete-2026-1.jpg                26-10-08_Note-bureau.pdf
                                    │
                                    ▼
             le nom existe déjà dans le dossier ?  ── oui ──▶  suffixe -2, -3 ...
                                                              26-10-08_10072_Ete-2026-1-2.jpg
```

- La date est celle du **dépôt** (date du serveur), au format `AA-MM-JJ` : les fichiers
  se trient chronologiquement par ordre alphabétique.
- L'identifiant (`ref_id`) n'est **pas** dans le nom : le lien document ↔ objet est porté
  par `files.docs.ref_id`, le nom sert à être lisible par un humain.
- Le nom ne contient que `A-Z a-z 0-9 _ - .` : il passe tel quel dans les URL `/files/...`
  et `/picts/img?file=...`.
- Pour ajouter une info propre à un autre type (ex. nom du projet MFU), ajouter une branche
  sur `libnomId` dans `construireNomDocument()`.

Les fichiers déposés avant octobre 2026 gardent l'ancien format
`doc_<ref_id>_<AAAA-M-J-ms>_<nom d'origine>` ; ils restent pleinement fonctionnels.

## 3. Affichage

### Liste des fichiers : `GET /sites/docs/:section/cd_type=:cd_type/:mode/:ref_id?`

Renvoie les lignes de `files.docs` (`doc_path` compris) pour une famille (`section` = libnom_id),
un type (`cd_type` = lib_id, `0` = tous) et un objet (`ref_id`).

### Vignettes : `GET /picts/img?file=<doc_path>&width=<px>` (`pictureRoute.js`)

```
 file = photos/travaux/avant/26-10-08_10072_Ete-2026-1.jpg      width = 200
                    │
                    ▼  nomFichierCache(doc_path, width)   (les "/" deviennent "_")
 FILES_DIR/cache/photos_travaux_avant_26-10-08_10072_Ete-2026-1_200.jpg
                    │
         ┌── existe ? ──┐
        oui            non
         │              │
         │              ▼
         │   original : FILES_DIR/<doc_path>
         │   (repli ancien format : FILES_DIR/photos/<doc_path>)
         │              │
         │   sharp : resize(width), JPEG qualité 80, écrit dans le cache
         │              │
         └──────┬───────┘
                ▼
          sendFile(vignette)
```

Une vignette est créée **par largeur demandée** (200, 217, 231...). Toutes ces variantes
partagent le même préfixe et sont supprimées ensemble (voir plus bas).
Le contenu d'une vignette est toujours du JPEG, même si son extension est `.png`.

### Fichier en taille réelle : `GET /files/<doc_path>`

Servi directement par `express.static(FILES_DIR_ENV)` (`node_base_sites.js`).

⚠️ Bug connu côté front : `image-view.component.ts` reconstruit l'URL avec
`files/photos/` + les **2 derniers segments** du chemin. Cela fonctionne pour
`photos/pmfu/x.jpg` mais pas pour `photos/travaux/avant/x.jpg` (→ `files/photos/avant/x.jpg`,
introuvable). Il faudrait utiliser `files/<doc_path>` directement.

## 4. Suppression : `DELETE /sites/delete/files.docs?doc_path=<doc_path>` (`sites/deleteSitesRoutes.js`)

```
 doc_path = photos/travaux/avant/26-10-08_10072_Ete-2026-1.jpg
                    │
                    ▼
 DELETE FROM files.docs WHERE doc_path = $1
                    │
            succès ?  ── non ──▶  500, rien n'est supprimé sur le disque
                    │ oui
                    ▼
 chemin = FILES_DIR/<doc_path>   (repli ancien format : FILES_DIR/photos/<doc_path>)
 hors de FILES_DIR ?  ── oui ──▶  400 (path traversal)
                    │
                    ▼  si image (jpg, jpeg, png)
 fichiersCacheDuDocument(doc_path, FILES_DIR/cache)
   motif exact :  ^photos_travaux_avant_26-10-08_10072_Ete-2026-1_<chiffres>\.jpg$
                    │
                    ├──▶ supprime  ..._Ete-2026-1_200.jpg      ✔
                    ├──▶ supprime  ..._Ete-2026-1_217.jpg      ✔
                    └──▶ ignore    ..._Ete-2026-1-2_200.jpg    ✘ (autre photo)
                    │
                    ▼
 unlink(FILES_DIR/<doc_path>)  ──▶  200
```

Le motif est une expression régulière exacte (préfixe + `_` + largeur), et non un glob
`<préfixe>_*` : un glob emportait aussi les vignettes des photos dont le nom commence
de la même façon (`photo` / `photo_b`), et cassait sur les caractères `[ ] * ?`.

## Arborescence du stockage

```
/mnt/storage_data/app/                  (FILES_DIR)
├── cache/                              vignettes : <doc_path avec "_">_<largeur>.<ext>
├── decision-bureau/                    pmfu   (lib_id 3)
├── note-bureau/                        pmfu   (lib_id 4)
├── projets-acte/                       pmfu   (lib_id 2)
├── exemple/  affichage/                site   (lib_id 5, 6)
├── photos/
│   ├── pmfu/                           pmfu   (lib_id 1)
│   └── travaux/
│       ├── avant/                      travaux (lib_id 7)
│       └── apres/                      travaux (lib_id 8)
└── autres/                             champ sans lib_path connu
```

## Fichiers concernés

| Fichier                              | Rôle                                                            |
|--------------------------------------|-----------------------------------------------------------------|
| `fonctions/fonctionsFichiers.js`     | Nommage des documents et des vignettes, recherche du cache      |
| `routes/sites/putSitesRoutes.js`     | Dépôt (multer `storagePmfu`, `fileFilter`, INSERT `files.docs`) |
| `routes/sites/getSitesRoutes.js`     | Liste des documents (`/docs/...`)                               |
| `routes/pictureRoute.js`             | Vignettes redimensionnées et cache (`/picts/img`)               |
| `routes/sites/deleteSitesRoutes.js`  | Suppression ligne + fichier + vignettes                         |
| `node_base_sites.js`                 | Service statique `/files`                                       |
