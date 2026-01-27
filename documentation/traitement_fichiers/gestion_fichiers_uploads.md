# Gestion des Fichiers Uploadés - Documentation Technique

## 📋 Vue d'ensemble

Ce document décrit l'architecture complète de gestion des fichiers (documents et images) dans l'application Node.js + Express.

---

## 📁 Architecture des Dossiers

### Dossiers de Stockage Principal

```
/mnt/storage_data/app/           ← FILES_DIR (racine des fichiers)
├── photos/                      ← IMAGES_DIR (images originales)
├── cache/                       ← CACHE_DIR (miniatures redimensionnées)
├── documents/                   ← Documents Word/PDF
├── plans/                       ← Plans techniques
├── autres/                      ← Autres fichiers
└── [autres dossiers dynamiques] ← Chargés depuis la BDD (table files.libelles)
```

### Configuration des Dossiers

**Fichier**: [node_base_sites.js](../../node_base_sites.js)
```javascript
const FILES_DIR_ENV = process.env.FILES_DIR_ENV || '/mnt/storage_data/app'
```

**Fichiers**: 
- [routes/sites/putSitesRoutes.js](../../routes/sites/putSitesRoutes.js) (lignes 30-40)
- [routes/pictureRoute.js](../../routes/pictureRoute.js) (lignes 14-17)
- [routes/sites/getSitesRoutes.js](../../routes/sites/getSitesRoutes.js) (lignes 8-14)

---

## 🔄 Flux 1: Upload de Documents (Word, PDF)

### Route d'Upload
**Route**: `PUT /sites/put/table=docs`  
**Fichier**: [routes/sites/putSitesRoutes.js](../../routes/sites/putSitesRoutes.js#L1132)

### Processus Détaillé

```
┌─────────────────┐
│  Client Web     │
│  (Frontend)     │
└────────┬────────┘
         │ PUT /sites/put/table=docs
         │ Multipart/form-data
         ▼
┌─────────────────────────────────────────┐
│  Middleware Multer                      │
│  multerMiddlewareDoc                    │
│  (configuré dynamiquement)              │
├─────────────────────────────────────────┤
│  1. Champs autorisés chargés depuis:    │
│     SELECT lib_field, max_upload_count  │
│     FROM files.libelles                 │
│                                         │
│  2. storagePmfu définit:                │
│     • destination(): Dossier cible      │
│     • filename(): Renommage             │
│       Format: doc_{refId}_{date}_{nom}  │
│                                         │
│  3. fileFilter(): Validation types      │
│     Autorisés: .pdf, .doc, .docx,       │
│                .jpg, .jpeg, .png        │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Stockage Physique                      │
│  /mnt/storage_data/app/{dossier}/       │
│  Exemple:                               │
│  /mnt/storage_data/app/documents/       │
│    doc_ABC123_2026-1-12-456_plan.pdf    │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Enregistrement en BDD                  │
│  INSERT INTO sitcenca.pmfu_docs         │
│  (ref_id, doc_path, doc_name, ...)      │
└─────────────────────────────────────────┘
```

### Fonctions Clés

#### `loadUploadFolders()`
**Fichier**: [routes/sites/putSitesRoutes.js](../../routes/sites/putSitesRoutes.js#L47)
- Charge dynamiquement les dossiers d'upload depuis `files.libelles`
- Crée les dossiers s'ils n'existent pas (avec umask 0o002)

#### `loadMulterFieldsConfig()`
**Fichier**: [routes/sites/putSitesRoutes.js](../../routes/sites/putSitesRoutes.js#L80)
- Configure les champs acceptés par Multer
- Définit le nombre max de fichiers par champ

#### `storagePmfu`
**Fichier**: [routes/sites/putSitesRoutes.js](../../routes/sites/putSitesRoutes.js#L102)
- **destination()**: Détermine le dossier cible selon `file.fieldname`
- **filename()**: Renomme avec pattern `doc_{ref_id}_{date}_{originalname}`

---

## 🖼️ Flux 2: Gestion des Images

### 2.1 Accès Direct aux Images (Taille Originale)

**Route**: `GET /files/photos/{nom_fichier}`  
**Fichier**: [node_base_sites.js](../../node_base_sites.js#L194)

```
┌─────────────────┐
│  Client Web     │ GET /files/photos/image.jpg
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Express Static Middleware              │
│  app.use("/files", express.static(...)) │
├─────────────────────────────────────────┤
│  Sert directement depuis:               │
│  /mnt/storage_data/app/photos/image.jpg │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  Image Originale│
│  (taille réelle)│
└─────────────────┘
```

### 2.2 Images Redimensionnées (avec Cache)

**Route**: `GET /picts/img?file={fichier}&width={largeur}`  
**Fichier**: [routes/pictureRoute.js](../../routes/pictureRoute.js#L25)

```
┌─────────────────┐
│  Client Web     │ GET /picts/img?file=photo.jpg&width=200
└────────┬────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│  Route /picts/img                        │
│  Fichier: routes/pictureRoute.js        │
└────────┬─────────────────────────────────┘
         │
         ▼
    ┌────────────────────────┐
    │  Vérification Cache    │
    │  Existe déjà ?         │
    └───┬─────────────┬──────┘
        │ OUI         │ NON
        │             │
        │             ▼
        │      ┌──────────────────────────────┐
        │      │  Redimensionnement           │
        │      │  • sharp(originalPath)       │
        │      │  • .resize(width)            │
        │      │  • .toFormat("jpeg", 80%)    │
        │      │  • .toFile(cachePath)        │
        │      └──────────────────────────────┘
        │             │
        │             ▼
        │      ┌──────────────────────────────────┐
        │      │  Stockage Cache                  │
        │      │  Pattern: {basename}_{width}.ext │
        │      │  Ex: photo_200.jpg               │
        │      │  /mnt/storage_data/app/cache/    │
        │      └──────────┬─────────────────────────┘
        │                 │
        └─────────────────┘
                  │
                  ▼
         ┌────────────────┐
         │  res.sendFile  │
         │  (depuis cache)│
         └────────────────┘
```

### Détails Techniques - Image Redimensionnée

**Fichier**: [routes/pictureRoute.js](../../routes/pictureRoute.js#L25-L73)

1. **Validation des paramètres**:
   - `file` et `width` obligatoires
   - `width` doit être un entier > 0

2. **Chemins**:
   - Original: `/mnt/storage_data/app/photos/{file}`
   - Cache: `/mnt/storage_data/app/cache/{basename}_{width}.{extension}`
   - Exemples: `photo.jpg` → `photo_200.jpg`, `paysage.png` → `paysage_800.png`
   - Note: Les `/` dans le nom sont remplacés par `_`

3. **Processus Sharp**:
   ```javascript
   await sharp(originalPath)
       .resize(w)           // Conserve proportions
       .toFormat("jpeg", { quality: 80 })
       .toFile(cachePath);
   ```

---

## 🗑️ Flux 3: Suppression de Fichiers

**Route**: `DELETE /sites/delete/:table?doc_path={chemin}`  
**Fichier**: [routes/sites/deleteSitesRoutes.js](../../routes/sites/deleteSitesRoutes.js#L119)

```
┌─────────────────┐
│  Client Web     │ DELETE /sites/delete/pmfu_docs?doc_path=documents/file.pdf
└────────┬────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│  Route DELETE /sites/delete/:table       │
│  Fichier: routes/sites/deleteSitesRoutes.js │
└────────┬─────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│  1. Suppression BDD                      │
│  DELETE FROM {table}                     │
│  WHERE doc_path = $1                     │
└────────┬─────────────────────────────────┘
         │ Si succès
         ▼
┌──────────────────────────────────────────┐
│  2. Validation Sécurité                  │
│  • Path traversal check                  │
│  • Fichier dans uploadsDir ?             │
│  • filePath.startsWith(uploadsDir)       │
└────────┬─────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│  3. Suppression Fichier Principal        │
│  fs.unlink(filePath)                     │
│  /mnt/storage_data/app/documents/file.pdf│
└────────┬─────────────────────────────────┘
         │
         ▼
    ┌────────────────────┐
    │  C'est une image ? │
    │  .jpg/.jpeg/.png   │
    └───┬──────────┬─────┘
        │ OUI      │ NON
        │          │
        │          └─────► FIN
        ▼
┌──────────────────────────────────────────┐
│  4. Suppression Cache Images (Glob)      │
│  Pattern: {basename}_*.{ext}             │
│  Exemple: photo_*.jpg trouve:            │
│    - photo_200.jpg                       │
│    - photo_400.jpg                       │
│    - photo_800.jpg                       │
│  Supprime TOUTES les résolutions         │
└──────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│  Réponse 200 OK                          │
│  { success: true, message: "..." }       │
└──────────────────────────────────────────┘
```

### Sécurité

**Fichier**: [routes/sites/deleteSitesRoutes.js](../../routes/sites/deleteSitesRoutes.js#L156-L164)

- **Protection Path Traversal**: Vérification que le fichier est bien dans `uploadsDir`
- **Double suppression**: BDD d'abord, puis fichiers physiques
- **Nettoyage du cache**: Automatique pour les images

---

## 📊 Table de Référence BDD

### Table `files.libelles`
**Utilisée par**: `loadUploadFolders()` et `loadMulterFieldsConfig()`

| Colonne           | Description                                    |
|-------------------|------------------------------------------------|
| `lib_field`       | Nom du champ Multer (ex: 'pmfu_docs')         |
| `lib_path`        | Nom du dossier physique (ex: 'documents')     |
| `max_upload_count`| Nombre max de fichiers par requête            |

### Table `sitcenca.pmfu_docs`
**Stockage des métadonnées des fichiers uploadés**

| Colonne      | Description                                |
|--------------|--------------------------------------------|
| `ref_id`     | Référence au projet/site                   |
| `doc_path`   | Chemin relatif du fichier                  |
| `doc_name`   | Nom du fichier original                    |
| `date_upload`| Date d'upload                              |

---

## 🔗 Routes Complètes

| Méthode | Route                                    | Fichier                      | Description                    |
|---------|------------------------------------------|------------------------------|--------------------------------|
| `GET`   | `/files/photos/{file}`                   | node_base_sites.js (static)  | Image originale                |
| `GET`   | `/picts/img?file=...&width=...`          | pictureRoute.js              | Image redimensionnée (cache)   |
| `PUT`   | `/sites/put/table=docs`                  | putSitesRoutes.js            | Upload documents/images        |
| `DELETE`| `/sites/delete/:table?doc_path=...`      | deleteSitesRoutes.js         | Suppression fichier + cache    |
| `PUT`   | `/sites/put/ope_shapefile`               | putSitesRoutes.js            | Upload shapefile (temporaire)  |

---

## 🚀 Initialisation au Démarrage

**Fichier**: [routes/sites/putSitesRoutes.js](../../routes/sites/putSitesRoutes.js#L47-L98)

```javascript
// 1. Chargement des dossiers d'upload depuis BDD
loadUploadFolders();  // Ligne 74
  └─> Crée les dossiers manquants
  └─> Remplit uploadFolders{}

// 2. Configuration dynamique de Multer
loadMulterFieldsConfig();  // Ligne 98
  └─> Charge les champs acceptés
  └─> Définit maxCount par champ
  └─> Crée multerFieldsConfig[]

// 3. Création du middleware Multer
multerMiddlewareDoc = createMulterMiddlewareDoc();  // Ligne 200
```

---

## 🔍 Cas d'Usage

### Scénario 1: Upload d'un PDF
1. Client envoie `PUT /sites/put/table=docs` avec fichier PDF
2. Multer valide le type (fileFilter)
3. Fichier renommé selon pattern: `doc_{refId}_{date}_{nom}.pdf`
4. Stocké dans `/mnt/storage_data/app/documents/`
5. Entrée créée en BDD dans `sitcenca.pmfu_docs`

### Scénario 2: Affichage d'une Photo Miniature
1. Client demande `GET /picts/img?file=photo.jpg&width=200`
2. Route vérifie si `/cache/photo_200.jpg` existe
3. Si non: redimensionne avec Sharp et met en cache
4. Renvoie l'image depuis le cache

### Scénario 3: Suppression d'une Photo (avec tous ses caches)
1. Client envoie `DELETE /sites/delete/pmfu_docs?doc_path=photos/photo.jpg`
2. Suppression en BDD
3. Suppression fichier original `/photos/photo.jpg`
4. Détection extension `.jpg` → recherche pattern `photo_*.jpg`
5. Suppression de **tous** les caches trouvés:
   - `/cache/photo_200.jpg`
   - `/cache/photo_400.jpg`
   - `/cache/photo_800.jpg`
   - (toutes les résolutions générées)
6. Logs affichent le nombre de caches supprimés
7. Réponse succès au client

---

## 📝 Notes Importantes

### Permissions Fichiers
- **umask**: 0o002 pour création dossiers (ligne 106 de putSitesRoutes.js)
- Assure permissions correctes pour partage entre processus

### Extensions Autorisées
**Fichier**: [routes/sites/putSitesRoutes.js](../../routes/sites/putSitesRoutes.js#L129-L163)
- Documents: `.pdf`, `.doc`, `.docx`
- Images: `.jpg`, `.jpeg`, `.png`

### Format Cache Images
- **Nouveau pattern** (depuis janv. 2026): `{nom_base}_{largeur}.{extension}`
- Exemples:
  - `photo.jpg` → Cache: `photo_200.jpg`, `photo_400.jpg`, `photo_800.jpg`
  - `paysage.png` → Cache: `paysage_200.png`
- Avantages:
  - Suppression simple avec glob: `photo_*` supprime tous les caches
  - Meilleur tri alphabétique
  - Plus intuitif (nom de base en préfixe)
- Caractères `/` dans les chemins remplacés par `_`
- Format JPEG avec qualité 80%

### Variables d'Environnement
```env
FILES_DIR_ENV=/mnt/storage_data/app  # Défini dans .env
```

### Dépendances Requises
**Package npm nécessaires**:
- `multer` - Upload de fichiers
- `sharp` - Redimensionnement d'images
- `glob` - Pattern matching pour suppression de caches (⚠️ requis depuis janv. 2026)

```bash
npm install multer sharp glob
```

---

## 🛠️ Maintenance

### Nettoyage du Cache
Actuellement, le cache est nettoyé uniquement lors de la suppression d'une image.  
**Amélioration possible**: Tâche cron pour supprimer les miniatures anciennes/non utilisées.

### Logs
Les opérations de fichiers sont loggées dans la console:
- Upload: nom fichier, dossier destination
- Redimensionnement: dimensions, fichier source/destination
- Suppression: chemins supprimés

---

## 📞 Fichiers Sources Principaux

1. **[node_base_sites.js](../../node_base_sites.js)** - Point d'entrée, montage routes
2. **[routes/sites/putSitesRoutes.js](../../routes/sites/putSitesRoutes.js)** - Upload fichiers
3. **[routes/pictureRoute.js](../../routes/pictureRoute.js)** - Images redimensionnées
4. **[routes/sites/deleteSitesRoutes.js](../../routes/sites/deleteSitesRoutes.js)** - Suppression fichiers
5. **[routes/sites/getSitesRoutes.js](../../routes/sites/getSitesRoutes.js)** - Récupération données (définit aussi les dossiers)

---

*Documentation générée le 12 janvier 2026*
