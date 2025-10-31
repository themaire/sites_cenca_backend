# Documentation de la route `/put/ope_shapefile`

Cette fiche décrit le workflow d'import d'un fichier zip contenant un shapefile (SIG) pour l'insertion de géométries dans la base de données.

## Objectif
Permettre à un utilisateur d'envoyer un zip contenant un shapefile (fichiers .shp, .dbf, etc.) afin d'insérer la géométrie dans la table `opegerer.localisations`.

## Workflow

1. **Réception du fichier**
   - La route attend un fichier zip via le champ `file`.
   - Vérification de la présence du fichier et du type de géométrie.

2. **Décompression**
   - Le zip est extrait dans `uploads/extracted`.
   - Si le zip contient un dossier, on travaille dans ce dossier ; sinon, directement dans `extracted`.
   - Tous les fichiers extraits sont renommés en `shapefile.<ext>`.

3. **Lecture du shapefile**
   - Détection du type de géométrie (Polygon, Point, LineString).
   - Ouverture du shapefile et lecture des features.

4. **Validation**
   - Si plusieurs polygones sont présents alors qu’un seul est attendu, une erreur est levée.
   - Si aucune géométrie n’est trouvée, une erreur est levée.

5. **Conversion et insertion SQL**
   - Conversion des coordonnées en WKT.
   - Détermination de la colonne cible (`loc_poly`, `loc_point`, `loc_line`).
   - Insertion dans la base via `INSERT INTO opegerer.localisations (...) VALUES (...)`.

6. **Réponse HTTP**
   - Succès : nombre de géométries importées.
   - Erreur : message détaillé.

7. **Nettoyage**
   - Suppression des fichiers temporaires extraits.

## Exemple de requête

```http
POST /put/ope_shapefile
Content-Type: multipart/form-data

file: <votre_zip>
type_geometry: POLYGON
uuid_ope: <uuid de l'opération>
```

## Réponse
- Succès :
```json
{
  "success": true,
  "message": "1 géométrie(s) importée(s) avec succès.",
  "data": [ ... ]
}
```
- Erreur :
```json
{
  "success": false,
  "message": "Erreur(s) lors de l'import.",
  "errors": [ ... ]
}
```

### Exemple détaillé

Exemple complet avec curl :
```bash
curl -X POST https://mon-api/put/ope_shapefile \
  -F "file=@/chemin/vers/mon_shapefile.zip" \
  -F "type_geometry=POLYGON" \
  -F "uuid_ope=123e4567-e89b-12d3-a456-426614174000"
```

Structure attendue du zip :
```
mon_shapefile.zip
├── mon_shapefile.shp
├── mon_shapefile.dbf
├── mon_shapefile.shx
└── (optionnel) mon_shapefile.prj
```

> Les fichiers peuvent être à la racine du zip ou dans un dossier.

Exemple de réponse complète (succès) :
```json
{
  "success": true,
  "message": "1 géométrie(s) importée(s) avec succès.",
  "data": [
    {
      "success": true,
      "type": "POLYGON",
      "data": [
        {
          "loc_poly": "SRID=2154;POLYGON((...))",
          "ref_uuid_ope": "123e4567-e89b-12d3-a456-426614174000"
        }
      ]
    }
  ]
}
```

Exemple de réponse complète (succès) :
```json
{
  "success": true,
  "message": "1 géométrie(s) importée(s) avec succès.",
  "data": [
    {
      "success": true,
      "type": "POLYGON",
      "data": [
        {
          "loc_poly": "SRID=2154;POLYGON((...))",
          "ref_uuid_ope": "123e4567-e89b-12d3-a456-426614174000"
        }
      ]
    }
  ]
}
```

Exemple de réponse complète (erreur) :
```json
{
  "success": false,
  "message": "Aucune géométrie trouvée dans le fichier shapefile",
  "errors": [
    { "success": false, "message": "Aucune géométrie trouvée dans le fichier shapefile" }
  ]
}
```

Cas d'erreur typiques :

* Fichier zip manquant ou corrompu
* Fichiers .shp ou .dbf absents
* Type de géométrie non précisé ou non reconnu
* Plusieurs polygones présents alors qu’un seul attendu
* UUID d’opération manquant ou invalide

Astuce frontend:

* Utiliser FormData pour envoyer le zip et les champs supplémentaires
* Afficher le message de réponse pour informer l’utilisateur
* Vérifier la structure du zip avant l’envoi


## Points d’attention
- Le zip doit contenir au minimum les fichiers `.shp` et `.dbf`.
- Le type de géométrie doit être précisé.
- Les fichiers temporaires sont nettoyés automatiquement.

---

*Documentation générée le 31/10/2025.*
