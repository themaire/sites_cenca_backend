# Import de géométries - Routes Shapefile et GeoJSON

## 📋 Vue d'ensemble

Deux routes permettent l'import de géométries vers la table `opegerer.localisations` :
- **`/put/ope_shapefile`** : Upload de shapefiles zippés
- **`/put/ope_geojson`** : Upload de fichiers GeoJSON

---

## 🗺️ Route `/put/ope_shapefile`

### Description
Import d'un shapefile compressé (.zip) contenant les fichiers `.shp`, `.dbf`, `.shx`, etc.

### Endpoint
```
POST /sites/put/ope_shapefile
```

### Paramètres (FormData)
| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `file` | File | ✅ | Fichier ZIP contenant le shapefile |
| `uuid_ope` | String | ✅ | UUID de l'opération de référence |
| `type_geometry` | String | ❌ | Type de géométrie (détecté auto si absent mais normalement donné) |

### Formats supportés
- ✅ `.zip` (application/zip)

### Contraintes
- **Polygones** : 1 seule géométrie maximum
- **Points/Lignes** : Multiple géométries acceptées

### Exemple cURL
```bash
curl -X POST http://localhost:8887/sites/put/ope_shapefile \
  -F "file=@mon_shapefile.zip" \
  -F "uuid_ope=123e4567-e89b-12d3-a456-426614174000"
```

---

## 🌍 Route `/put/ope_geojson`

### Description
Import d'un fichier GeoJSON standard.

### Endpoint
```
POST /sites/put/ope_geojson
```

### Paramètres (FormData)
| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `file` | File | ✅ | Fichier GeoJSON (.geojson ou .json) |
| `uuid_ope` | String | ✅ | UUID de l'opération de référence |

### Formats supportés
- ✅ `.geojson` (application/geo+json)
- ✅ `.json` (application/json)

### Types GeoJSON acceptés
- **FeatureCollection** : Collection de géométries
- **Feature** : Géométrie unique avec propriétés
- **Geometry** : Point, LineString, Polygon, MultiPoint, MultiLineString, MultiPolygon

### Contraintes
- **Polygones** : 1 seule géométrie maximum
- **Points/Lignes** : Multiple géométries acceptées
- Tous les features doivent avoir le **même type de géométrie**

### Exemple GeoJSON valide
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [4.5, 48.5],
            [4.6, 48.5],
            [4.6, 48.6],
            [4.5, 48.6],
            [4.5, 48.5]
          ]
        ]
      },
      "properties": {
        "nom": "Zone test"
      }
    }
  ]
}
```

### Exemple cURL
```bash
curl -X POST http://localhost:8887/sites/put/ope_geojson \
  -F "file=@ma_zone.geojson" \
  -F "uuid_ope=123e4567-e89b-12d3-a456-426614174000"
```

---

## ⚙️ Traitement commun

Les deux routes utilisent la **fonction commune** `insertGeometryToDB()` :

### Mapping colonnes PostgreSQL
| Type géométrie | Colonne BDD |
|---------------|-------------|
| POLYGON / MULTIPOLYGON | `loc_poly` |
| POINT / MULTIPOINT | `loc_point` |
| LINESTRING / MULTILINESTRING | `loc_line` |

### Système de coordonnées
- **Entrée** : WGS84 (EPSG:4326) par défaut
- **Stockage** : EWKT dans PostGIS

---

## 📤 Réponses HTTP

### ✅ Succès (200)
```json
{
  "success": true,
  "message": "2 géométrie(s) importée(s) avec succès.",
  "data": [
    {
      "success": true,
      "type": "POLYGON",
      "data": { ... }
    }
  ]
}
```

### ❌ Erreur validation (400)
```json
{
  "success": false,
  "message": "Format GeoJSON invalide: propriété 'type' manquante"
}
```

### ❌ Erreur serveur (500)
```json
{
  "success": false,
  "message": "Erreur(s) lors de l'import.",
  "errors": [
    { "success": false, "message": "..." }
  ]
}
```

---

## 🔍 Logs de débogage

Les deux routes génèrent des logs détaillés :
```
[SHAPEFILE] Requête reçue pour le traitement d'un shapefile
[SHAPEFILE] Type de géométrie détecté : POLYGON
[SHAPEFILE] === Traitement géométrie [0] ===
[COMMON] Type de géométrie: POLYGON
[COMMON] Colonne cible: loc_poly
[COMMON] WKT: SRID=4326;POLYGON((4.5 48.5, ...))
```

---

## 🚀 Côté Frontend Angular

### Service d'upload
```typescript
uploadShapefile(file: File, uuidOpe: string): Observable<any> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('uuid_ope', uuidOpe);
  
  return this.http.post('/sites/put/ope_shapefile', formData);
}

uploadGeoJSON(file: File, uuidOpe: string): Observable<any> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('uuid_ope', uuidOpe);
  
  return this.http.post('/sites/put/ope_geojson', formData);
}
```

### Sélection automatique
```typescript
handleFileUpload(file: File, uuidOpe: string) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  
  if (extension === 'zip') {
    this.uploadShapefile(file, uuidOpe).subscribe(...);
  } else if (extension === 'geojson' || extension === 'json') {
    this.uploadGeoJSON(file, uuidOpe).subscribe(...);
  } else {
    console.error('Format non supporté');
  }
}
```

---

## 📝 Notes importantes

1. **Nettoyage automatique** : Les fichiers temporaires sont supprimés après traitement
2. **Validation stricte** : Format et structure validés avant insertion
3. **Code factorisé** : La logique d'insertion est commune aux deux routes
4. **Extensible** : Facile d'ajouter d'autres formats (KML, GPX, etc.)

---

**Date de création** : 27 janvier 2026  
**Auteur** : GitHub Copilot  
**Version** : 1.0
