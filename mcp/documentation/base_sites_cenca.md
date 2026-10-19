# Base des sites du CEN Champagne-Ardenne (PostgreSQL 17 / PostGIS 3.6)

Base `lizmap_cenca_maps`, hébergée chez Lizmap (3liz). Elle alimente l'application web métier (Angular + API Node « node_pgsql ») et les cartes Lizmap/QGIS. Accès ici en **lecture seule**.

> Ce fichier est la mémoire métier du serveur MCP : quand Claude se trompe sur le sens d'une donnée, c'est ici qu'il faut corriger ou compléter.

## Conventions générales

- **Identifiants** : la plupart des clés sont des `varchar` contenant un UUID (`uuid_site`, `uuid_espace`, `uuid_proj`, `uuid_ope`, `uuid_acte`, `uuid_ann`…). Les liens entre tables sont **rarement déclarés en clés étrangères** : se fier aux jointures ci-dessous.
- **Tables de types** : `typ_*` avec `cd_type` (code) et `libelle` (souvent aussi `libelle_court`, `val_tri`, `val_filtre`). Jointure : `LEFT JOIN sitcenca.typ_sites ts ON ts.cd_type = s.typ_site`.
- **Libellés génériques** : `opegerer.libelles` / `sitcenca.libelles` (`lib_id`, `lib_libelle`, `libnom_id` = liste d'appartenance). Fonctions : `opegerer.get_libelle(lib_id)`, `ope.get_action_libelle(cd_action)`.
- **`validite`** (booléen) : `false` = enregistrement désactivé ou supprimé logiquement. Filtrer avec `validite IS NOT FALSE` (les `NULL` comptent comme valides).
- **`actuel`** : marque la version en vigueur (site, acte, document de gestion).
- **Géométries** : **Lambert 93, SRID 2154**, en mètres. `ST_Area(geom) / 10000` = hectares. Pour un affichage : `ST_AsGeoJSON(ST_Transform(geom, 4326), 6)`. Certaines vues ont un SRID déclaré à 0 (`sitcenca.v_sites.geom_pt`, `sitcenca.geomparcelles`…) : la géométrie est quand même en 2154.
- **Texte** : extensions `unaccent` et `pg_trgm` disponibles → `unaccent(nom) ILIKE unaccent('%marais%')`.
- **Départements** : 08 Ardennes, 10 Aube, 51 Marne, 52 Haute-Marne (2 premiers caractères du code INSEE).
- **Schémas datés** (`hab_20260604_exp`, `hab_20260605`, `opeautres_20260512`) : copies de sauvegarde, à ignorer sauf demande explicite.

## Site et espace : le cœur du modèle

Un **site** (`sitcenca.sites`) est la dimension « gestion CEN » d'un **espace** (`esp.espaces`) qui porte le nom, la surface et la géométrie.

```
sitcenca.sites.espace  ->  esp.espaces.uuid_espace
esp.geometries.espace  ->  esp.espaces.uuid_espace     (contours, MULTIPOLYGON 2154, plusieurs possibles, filtrer validite IS NOT FALSE)
esp.localisations      (espace, commune = code INSEE) -> terr.listecommunes.insee_com
```

### `sitcenca.sites`
`uuid_site`, `code` (code site CEN : 5 chiffres comme `10035` pour la majorité, ou `51BOIS01` ; un code à 5 chiffres n'est pas un code INSEE), `espace`, `typ_site` → `sitcenca.typ_sites`, `responsable` → `admin.salaries.cd_salarie`, `prem_ctr` (année du premier contrat), `ref_fcen` (référence fédération des CEN), `pourc_gere`, `surf_actes`, `parties_gerees`, `typ_ouverture`, `description_site`, `sensibilite` / `remq_sensibilite` (site sensible : ne pas diffuser la localisation), `ref_public` (diffusable au public), `id_mnhn` / `url_mnhn` (fiche INPN), `url_cen`, `ref_pmfu_id` → `sitcenca.projets_mfu.pmfu_id`, `validite`, `actuel`.

### `esp.espaces`
`uuid_espace`, `id_espace`, `nom` (**le nom du site est ici**), `surface` (déclarée), `typ_espace` → `esp.typ_espaces`, `zh` (zone humide), `bassin_agence`, `typ_geologie`, `carto_hab`, `rgpt`.

### Vues pratiques
- **`sitcenca.listesitescenca`** : une ligne par site, déjà jointe : `uuid_site`, `code`, `nom`, `typ_site`, `typ_site_txt`, `statut`, `communes` (texte), `insee` (texte), `milieux_naturels` (texte), `bassin_agence`, `responsable`, `prem_ctr`, `fin`, `alerte_fin`, `validite`, `espace`. C'est la vue de la barre de recherche de l'application.
- `sitcenca.v_sites` (avec `geom`, `geom_pt`), `sitcenca.v_sites_diffusable` (sites publiables, utilisée par le site vitrine).
- `sitcenca.conservateurs` (`site`, `societe` → `ann.annuaire.uuid_ann`) : conservateurs bénévoles.

## Maîtrise foncière et d'usage (MFU)

```
sitcenca.actes_mfu.site           -> sitcenca.sites.uuid_site        (site principal de l'acte)
sitcenca.actes_mfu_multi          (ref_uuid_acte, ref_uuid_site)     (sites supplémentaires d'un acte multi-sites)
sitcenca.parcelles_mfu.acte_mfu   -> sitcenca.actes_mfu.uuid_acte
sitcenca.actes_mfu.typ_mfu        -> sitcenca.typ_mfu.cd_type        (convention, bail, acquisition…)
sitcenca.parcelles_mfu.typ_proprietaire -> sitcenca.typ_proprietaires.cd_type
```

- **Piège** : les actes d'un site = `a.site = :uuid` **OU** un lien dans `actes_mfu_multi`. Ne pas oublier la deuxième partie.
- `actes_mfu` : `debut`, `fin`, `tacit_rec` (reconduction tacite) + `detail_rec`, `notaire`, `cout` (texte), `remarque`, `url`, `validite`, `actuel`.
- `parcelles_mfu` : `insee`, `prefix`, `section`, `numero`, `partie`, `code_parcelle`, `surface`, `pour_partie` (seule une partie de la parcelle est concernée), `proprietaire`.
- Vue `sitcenca.listeallactes` : actes avec nom du site, type de propriétaire et surface totale.
- **Projets MFU** (`sitcenca.projets_mfu`, colonnes `pmfu_*`) : animation foncière en cours (acquisitions ou conventions en projet), avec tableaux d'entiers (`pmfu_territoire`, `pmfu_financements`…) renvoyant à `sitcenca.libelles.lib_id`, et listes de parcelles et communes en tableaux. Responsable : `pmfu_responsable` → `admin.salaries.cd_salarie`.

## Documents de planification (plans de gestion)

```
docplan.documents.site              -> sitcenca.sites.uuid_site
docplan.documents.entite_coherente  -> docplan.entites_coherentes.uuid_ecg   (document couvrant plusieurs sites)
docplan.documents.typ_document      -> docplan.typ_documents.cd_type
docplan.unites_gestion.document     -> docplan.documents.uuid_doc
```
`annee_deb`, `annee_fin` (période de validité), `actuel`, `surface`, `url`, `evaluation`. Vue `docplan.docplanifsites`.

## Gestion et travaux

```
opegerer.projets.site               -> sitcenca.sites.uuid_site
opegerer.operations.ref_uuid_proj   -> opegerer.projets.uuid_proj
opegerer.localisations              (ref_uuid_ope, ref_uuid_proj ; loc_poly / loc_line / loc_point en 2154)
opegerer.operation_financeurs       (uuid_ope, checkbox_id -> opegerer.libelles.lib_id)
opegerer.operation_animaux          (uuid_ope, checkbox_id -> opegerer.libelles.lib_id)
opegerer.objectifs.projet           -> opegerer.projets.uuid_proj
opegerer.operations.action / action_2 -> ope.actions.cd_action      (action_2 = sous-type, le plus parlant)
opegerer.operations.ref_uuid_ann    -> ann.annuaire.uuid_ann        (maître d'œuvre)
opegerer.projets.responsable        -> admin.salaries.cd_salarie
```

- **Projets** : `typ_projet = 'TRV'` pour les travaux ; `pro_webapp = true` = projet saisi dans l'application web. Les projets plus anciens viennent de l'application MS Access : ils n'ont pas d'opérations détaillées dans `opegerer.operations` (voir `ope.synthesesites` pour leur résumé).
- Vue **`ope.listeprojets`** : liste des projets avec `annee`, `responsable`, `loc`, `titre`, `nb_ope`, `statut`, `typ_projet`.
- `ope.actions` est une **arborescence** (`cd_action`, `niveau`, `cd_sup` = parent, `libelle`).
- **Type d'opération affiché** : l'application montre `ope.get_action_libelle(action_2)` (la deuxième moitié de « action / action_2 »).
- **Maître d'œuvre** : la source de vérité est `ref_uuid_ann` → `ann.annuaire`. `nom_mo` est un ancien champ texte libre, encore rempli, à utiliser seulement si `ref_uuid_ann` est vide. Quelques doublons existent dans l'annuaire (« Entr'in 52 » / « Entrin 52 », « CIN Auberive » / « CIN d'Auberive »…).
- **Piège** : `uuid_ope` n'est pas fiable pour rapprocher une opération entre la table des opérations et celle des localisations. La clé robuste est `action | action_2 | date_debut`.
- Quantités : `quantite` + `unite` (`opegerer.get_libelle(unite)`), `surf` (surface), `lin` (linéaire). Pâturage : `effectif_paturage`, `nb_jours_paturage`, `chargement_paturage`, `ugb_moy`. Fauche : `exportation_fauche`, `total_exporte_fauche`, `productivite_fauche`.
- `opeautres.projets` : autres projets (hors gestion de sites), même logique.

## Annuaire et salariés

- **`ann.annuaire`** : contacts (personnes, entreprises, associations, communes…) : `uuid_ann`, `nom`, `adresse`, `telephone`, `mail`, `typ_personne` → `ann.typ_personnes`, `validite`, `actuel`. Étiquettes : `ann.etiquettes` / `ann.typ_etiquettes`, compétences : `ann.competences` / `ann.typ_competences`.
- **`admin.salaries`** : salariés (`cd_salarie`, `nom`, `prenom`, `email`, `statut`, `typ_fonction`, `date_embauche`, `date_depart`). Les colonnes d'authentification sont masquées par le serveur MCP. `admin.blacklist_token` est inaccessible.

## Territoire et référentiels

- `terr.listecommunes` : `insee_com`, `nom`, `insee_dep`, `insee_reg`, `siren_epci`.
- Contours IGN (2154) : `terr.ign_commune`, `terr.ign_departement`, `terr.ign_epci`, `terr.ign_region`, `terr.territoires`, `terr.bassins_agences`, Corine Land Cover `terr."LANDCOVER.CLC18_FR:clc18_fr"`, mares `terr.mares`.
- Zonages : `n2000.espaces_n2000` (Natura 2000), `esp.apb` (arrêtés de protection de biotope).
- `inpn`, `bd_topo` : référentiels nationaux.

## Autres schémas (domaines spécialisés)

- `chiro` : suivi des chiroptères (gîtes `chiro.sites`, `chiro.localisations`, relevés, observations, mortalités, nombreuses tables `typ_*`).
- `hab` : habitats naturels ; `obsbiodiv` : observations ; `irenee`, `life_connexions`, `rqdb`, `librevo`, `mescomp` : projets et programmes spécifiques.
- `gestint` : intranet (actualités `news`, menus) ; `files` : documents attachés (`files.docs`, `ref_id`, `doc_type`).
- `lizmap_maps` : couches techniques des cartes Lizmap.

Pour tout schéma peu connu : `lister_tables`, puis `decrire_table` (la définition des vues est renvoyée, c'est souvent la meilleure documentation des jointures).

## Exemples de requêtes

Surface calculée des sites par type :
```sql
SELECT ts.libelle, count(DISTINCT s.uuid_site) AS nb, round(sum(ST_Area(g.geom))::numeric / 10000, 1) AS ha
FROM sitcenca.sites s
JOIN esp.geometries g ON g.espace = s.espace AND g.validite IS NOT FALSE
LEFT JOIN sitcenca.typ_sites ts ON ts.cd_type = s.typ_site
WHERE s.validite IS NOT FALSE
GROUP BY 1 ORDER BY 3 DESC;
```

Sites intersectant une zone Natura 2000 :
```sql
SELECT DISTINCT s.code, e.nom
FROM sitcenca.sites s
JOIN esp.espaces e ON e.uuid_espace = s.espace
JOIN esp.geometries g ON g.espace = e.uuid_espace AND g.validite IS NOT FALSE
JOIN n2000.espaces_n2000 n ON ST_Intersects(n.geom, g.geom);
```

Actes d'un site, multi-sites compris :
```sql
SELECT a.* FROM sitcenca.actes_mfu a
WHERE a.site = $1
   OR EXISTS (SELECT 1 FROM sitcenca.actes_mfu_multi m WHERE m.ref_uuid_acte = a.uuid_acte AND m.ref_uuid_site = $1);
```

## À vérifier / à compléter
- Unité de `esp.espaces.surface` et de `sitcenca.parcelles_mfu.surface` (ha ou m²) : à confirmer, comparer avec `ST_Area`.
- Valeurs possibles de `listesitescenca.statut`, `opegerer.projets.statut` et du champ `responsable` des vues (code salarié ou nom).
