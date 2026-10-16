# Import de géométries - Routes Shapefile et GeoJSON

## 📋 Vue d'ensemble

Deux routes permettent l'import de l'emprise d'une opération dans la table `opegerer.localisations` :
- **`/put/ope_shapefile`** : Upload de shapefiles zippés
- **`/put/ope_geojson`** : Upload de fichiers GeoJSON

Les deux routes sont **protégées par JWT** (`Authorization: Bearer <token>`, ajouté par l'intercepteur Angular)
et partagent le module `fonctions/importGeometries.js`.

**Un import = une ligne** dans `opegerer.localisations` : toutes les entités du fichier sont fusionnées
en une seule géométrie `MultiPolygon`, `MultiLineString` ou `MultiPoint`.

---

## 🗺️ Route `/put/ope_shapefile`

### Endpoint
```
POST /sites/put/ope_shapefile
```

### Paramètres (FormData)
| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `file` | File | ✅ | Fichier ZIP contenant le shapefile (50 Mo max) |
| `uuid_ope` | String | ✅ | UUID de l'opération de référence |
| `type_geometry` | String | ❌ | Ignoré : le type est lu dans le fichier |

### Contenu de l'archive
- Un **seul** shapefile (`.shp` obligatoire, `.prj` fortement conseillé), à la racine ou dans un dossier
- Les fichiers `__MACOSX/` et `._*` sont ignorés ; seuls `.shp .shx .dbf .prj .cpg` sont extraits
- Les attributs (`.dbf`) ne sont pas utilisés

### Projection (fichier `.prj`)
| `.prj` | SRID retenu |
|--------|-------------|
| Lambert 93 (ESRI ou OGC) | 2154 |
| Coniques CC42 à CC50 | 3942 à 3950 |
| Lambert II étendu | 27572 |
| WGS84 / Pseudo-Mercator / UTM 31N | 4326 / 3857 / 32631 |
| WKT OGC avec `AUTHORITY["EPSG", …]` final | ce code EPSG |
| absent ou non reconnu | déduit des coordonnées (degrés → 4326, sinon 2154) |

### Exemple cURL
```bash
curl -X POST http://localhost:8887/sites/put/ope_shapefile \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@mon_shapefile.zip" \
  -F "uuid_ope=123e4567-e89b-12d3-a456-426614174000"
```

---

## 🌍 Route `/put/ope_geojson`

### Endpoint
```
POST /sites/put/ope_geojson
```

### Paramètres (FormData)
| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| `file` | File | ✅ | Fichier GeoJSON (`.geojson` ou `.json`, 50 Mo max) |
| `uuid_ope` | String | ✅ | UUID de l'opération de référence |

### Types GeoJSON acceptés
- **FeatureCollection**, **Feature**, ou géométrie directe
- Géométries : Point, LineString, Polygon, MultiPoint, MultiLineString, MultiPolygon (avec ou sans Z)

### Projection
- Lue dans le membre `crs` (`urn:ogc:def:crs:EPSG::2154`, `EPSG:2154`, `…CRS84`) — c'est ce qu'écrit QGIS
- Sans `crs` : déduite des coordonnées (degrés → WGS84, norme GeoJSON ; sinon Lambert 93)

### Exemple cURL
```bash
curl -X POST http://localhost:8887/sites/put/ope_geojson \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@ma_zone.geojson" \
  -F "uuid_ope=123e4567-e89b-12d3-a456-426614174000"
```

---

## ⚙️ Traitement commun : `insererLocalisation()`

La conversion est confiée à PostGIS, à partir du GeoJSON (plus de WKT construit à la main) :

```
ST_GeomFromGeoJSON → ST_Force2D → ST_SetSRID(srid source) → ST_Transform(2154)
  polygones      : ST_MakeValid puis ST_UnaryUnion  (répare et fusionne les chevauchements)
  points / lignes: ST_Collect
→ ST_CollectionExtract → ST_Multi
```

| Type géométrie | Colonne BDD |
|---------------|-------------|
| POLYGON / MULTIPOLYGON | `loc_poly` geometry(MultiPolygon, 2154) |
| LINESTRING / MULTILINESTRING | `loc_line` geometry(MultiLineString, 2154) |
| POINT / MULTIPOINT | `loc_point` geometry(MultiPoint, 2154) |

Contrôles, dans **une transaction** (tout ou rien) :
- l'opération `uuid_ope` existe (sinon 404)
- un seul type (point, ligne ou polygone) dans le fichier
- la géométrie obtenue n'est pas vide et tombe dans l'emprise du Lambert 93 (détecte une mauvaise projection)

---

## 📤 Réponses HTTP

### ✅ Succès (200)
```json
{
  "success": true,
  "message": "2 entité(s) de type ligne importée(s) (300 m).",
  "data": {
    "loc_id": 441,
    "type": "ligne",
    "srid_source": 2154,
    "nb_entites": 2,
    "nb_geometries": 4,
    "surface_m2": null,
    "longueur_m": 300.2
  }
}
```

### ❌ Erreurs
| Code | Cas |
|------|-----|
| 400 | fichier absent, mauvaise extension, trop gros, `uuid_ope` absent, JSON/zip illisible, plusieurs shapefiles, types mélangés, géométrie invalide, hors de France |
| 401 / 403 | token absent, expiré ou blacklisté |
| 404 | opération introuvable |
| 500 | erreur serveur (détail dans les logs) |

```json
{ "success": false, "message": "Le fichier mélange des lignes et des polygones : un seul type de géométrie par import." }
```

---

## 📝 Notes

1. **Fichiers temporaires** : chaque import shapefile est extrait dans son propre dossier `uploads/extracted/shp-XXXX`,
   supprimé à la fin avec le fichier uploadé (deux imports simultanés ne se gênent plus)
2. **Extraction sûre** : les noms des fichiers extraits sont générés (`shapefile.<ext>`), jamais repris de l'archive

---

**Date de création** : 27 janvier 2026
**Mise à jour** : 12 octobre 2026 — conversion PostGIS, fusion en une ligne, reprojection, transaction, JWT
