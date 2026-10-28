# Instructions pour Claude Code : saisie des projets « autres » (hors travaux)

> À donner en début de session Claude Code dans le dépôt front (`sites_cenca`), par exemple :
> « Lis `instructions_front_projets_autres.md` et crée la recherche et le formulaire des projets autres ».

## Pourquoi

La webapp ne sait saisir que les projets **travaux** (`typ_projet = 'TRV'`, schéma `opegerer`). Les collègues saisissent encore tous les autres types dans l'interface MS Access historique : sensibilisation, études et suivis, police, foncier, partenariats, accompagnement, administratif, autre. Cette interface est branchée sur la même base PostgreSQL, et ils l'utilisent encore en 2026 ; les données vont dans le schéma `opeautres`.

Le backend expose maintenant ces projets sous `/sites/autres`. Le front doit offrir **une recherche** et **un formulaire projet + opérations**, distincts de ceux des travaux. La webapp écrit dans les mêmes tables que l'interface Access : un projet saisi d'un côté se lit et se modifie de l'autre.

**Un seul formulaire pour tous les types.** Dans `opeautres`, un projet de sensibilisation, d'étude ou de police a exactement la même structure : aucune colonne ni table n'est propre à un type. Ce qui distingue une animation d'un suivi, ce sont les valeurs saisies : l'action choisie dans l'arbre, la famille de cibles et les indicateurs. Le type de projet sert donc à **préremplir et ordonner** les listes, pas à changer les champs du formulaire. Les travaux font exception : ils ont des colonnes dédiées (fauche, pâturage, hydraulique…) et gardent leurs propres écrans.

## Modèle de données (pour concevoir le formulaire)

```
Projet (opeautres.projets)
 ├─ nom, typ_projet (SEN, ETU, POL, FON, PAR, ACC, ADM, AUT), annee, statut, responsable, programme
 ├─ code et createur : calculés par le backend (ex. SENVGS15/10/2026 = type + créateur + date)
 └─ Opérations (opeautres.operations) : une ligne par action réalisée
     ├─ action        : une action de l'arbre ope.actions (ex. 9 Sensibilisation > 46 Sorties et animations > 167 Animations grand public)
     ├─ date_deb, date_fin, detail (2000 car. maxi), typ_interv (mode d'intervention : régie, bénévoles, prestataire…), com_interv
     ├─ localisations[] : sites CENCA, autres espaces (N2000, RN…), territoires, communes (presque toujours renseigné)
     ├─ cibles[]        : public visé (Grand public, Scolaire…) OU compartiment écologique (Habitats, Odonates…), + détail libre
     ├─ indicateurs[]   : indicateur chiffré, ex. « Nb personnes = 12 », « Nb passages = 1 »
     └─ intervenants[]  : contact de l'annuaire + rôle (Maître d'ouvrage, Maître d'œuvre, Bénévole)
```

Usage réel par type, pour les valeurs à proposer en premier (opérations 2023+) :

| Type | Branche d'actions | Cibles le plus souvent | Indicateurs les plus fréquents |
|---|---|---|---|
| SEN Sensibilisation | 9 | publics | Nb personnes, Nb intervention |
| ETU Études et suivis | 3 (et 10, 7) | écologiques | Nb passages, Nb individus, Compte-rendu dispo |
| PAR Partenariat | 15, 14, 12 | les deux | Nb personnes, Nombre de réunions, Nb contrat signé |
| ACC Accompagnement | 14 | écologiques | Nb intervention, Nombre de réunions |
| POL Police | 2 | écologiques | Nb passages, Nb intervention |
| ADM, FON, AUT | 15/14, 1, 10 | variable | Nombre de réunions, Nb personnes |

## Contrat de l'API

Base : `{environment.apiBaseUrl}sites/autres/`. Les **GET** sont publics, comme les autres GET de `/sites`. Les **POST, PUT et DELETE** exigent `Authorization: Bearer <token>`. Sans token, ils répondent `401 { "message": "Token manquant" }` ; avec un token expiré, `401` avec `code: "TOKEN_EXPIRE"`. L'intercepteur doit couvrir ces URL.

Dates : envoyées et reçues en `AAAA-MM-JJ`. Les versions `date_deb_str`/`date_fin_str` (`JJ/MM/AAAA`) servent à l'affichage.

Erreurs de saisie : `400 { success: false, message: "Données invalides.", erreurs: ["action obligatoire", "localisation inconnue : …"] }`. Toutes les erreurs arrivent en même temps : les afficher sous le formulaire. Objet introuvable : `404`. Erreur serveur : `500 { success: false, message, detail }`.

### Listes du formulaire

**`GET nomenclatures`** : un seul appel au chargement du formulaire.

```json
{
  "typ_projets": [{ "cd_type": "SEN", "libelle": "Sensibilisation et Communication" }, …],   // sans TRV ni NR
  "statuts": ["Programmé", "En cours", "Terminé", "Annulé"],
  "cibles": {
    "publics":     [{ "cd_type": "GP", "libelle": "Grand public" }, …],                      // 7
    "ecologiques": [{ "cd_type": "2.1.1", "libelle": "Insectes - Odonates", "groupe": "2.1" }, …], // 63, groupe = code parent
    "autres":      [{ "cd_type": "PRO", "libelle": "Propriétaire" }]
  },
  "indicateurs":       [{ "cd_type": "NBPER", "libelle": "Nb personnes" }, …],
  "roles":             [{ "cd_type": "MOUVR", "libelle": "Maitre d'ouvrage" }, …],
  "typ_interventions": [{ "cd_type": "REG", "libelle": "Régie exclusivement", "val_filtre": null }, …],
  "programmes":        [{ "cd_type": "24-A.MT.10", "libelle": "24-A.MT.10 - …" }, …]   // facultatif, plus alimenté depuis 2025
}
```

Salariés (responsable) : la route existante `GET sites/selectvalues=admin.salaries`. Contacts (intervenants) : les routes de l'annuaire, déjà utilisées par le front.

**`GET actions?typ_projet=SEN`** : arbre des actions hors travaux, imbriqué dans `enfants`. Les branches conseillées pour le type arrivent en tête avec `conseillee: true`. Les autres branches restent proposées : une opération d'un projet de partenariat peut par exemple être une étude.

```json
[{ "cd_action": "9", "libelle": "Sensibilisation", "conseillee": true, "profondeur": 1, "commentaire": null,
   "enfants": [{ "cd_action": "46", "libelle": "Sorties et animations", "enfants": [{ "cd_action": "167", "libelle": "Animations grand public", "enfants": [] }, …] }, …] },
 …]
```

Toute action de l'arbre est acceptée, les nœuds intermédiaires compris, car les données historiques en contiennent. Il vaut mieux faire choisir une feuille : une liste en cascade sur 2 ou 3 niveaux, ou un sélecteur arborescent avec recherche.

**`GET localisants?q=fepin`** (optionnel : `&cat=COM`, `&limite=50`, maximum 500) : autocomplétion des lieux, sans accents, sur le nom ou le code (code site, n° INSEE). Il faut au moins 2 caractères, sinon `400`.

```json
[{ "cd_localisation": "COMMUNE_0000000009728591", "code": "08166", "libelle": "FEPIN", "cat": "COM", "description": "Communes" }]
```

Valeurs de `cat` : `SITE CENCA`, `AUTRE CENCA`, `N2000`, `RN`, `AP`, `ZIE`, `PN`, `TMIL`, `CDL`, `RB`, `RAMSAR`, `TERR`, `COM`. Afficher `cat` en badge à côté du nom.

### Recherche

**`GET selectors`** : `{ annees: [2026, 2025…], responsables: [{ cd_type, libelle }], typ_projets: [...], statuts: [...] }` pour la barre de recherche (le type NR, « Non renseigné », y figure pour retrouver les anciens projets saisis sans type).

**`GET projets?annee=2026&typ_projet=SEN&responsable=VGS&statut=Terminé&texte=armoise&uuid_site=…&cd_localisation=…&limite=500`** : tous les paramètres sont facultatifs. `texte` cherche dans le nom du projet et le détail des opérations, sans accents. `uuid_site` sert pour l'onglet « autres actions » de la fiche site : il accepte l'`uuid_site` **ou** l'`uuid_espace` du site (c'est l'`uuid_espace` qui est stocké comme localisation des opérations). Le tri se fait par année puis par date de création, en ordre décroissant ; limite par défaut 500, maximum 2000.

```json
[{ "uuid_proj": "…", "code": "SENVGS15/10/2026", "nom": "Animation nature - Retour d'expérience", "annee": 2026,
   "statut": "Terminé", "typ_projet": "SEN", "typ_projet_libelle": "Sensibilisation et Communication",
   "responsable": "VGS", "responsable_str": "Virginie Schmitt", "programme": null, "createur": "VGS",
   "date_crea": "2026-10-15", "nb_ope": 2, "date_deb": "2026-06-20", "date_fin": "2026-09-11",
   "localisations": "Mont des Parisiens | Pré du Garde" }]
```

### Lecture d'un projet

**`GET projets/:uuid`** : les champs du projet, plus `operations[]` complètes :

```json
{ "uuid_proj": "…", "code": "…", "nom": "…", "annee": 2026, "statut": "En cours", "typ_projet": "SEN", "typ_projet_libelle": "…",
  "responsable": "VGS", "responsable_str": "…", "programme": null, "createur": "VGS", "date_crea": "2026-10-15", "validite": true,
  "ouvert_par": [{ "compte": "VGS", "nom": "Virginie Schmitt" }],   // fiche ouverte dans l'interface Access, [] sinon
  "operations": [{
    "uuid_ope": "…", "uuid_proj": "…", "action": "167",
    "action_chemin": [{ "cd_action": "9", "libelle": "Sensibilisation" }, { "cd_action": "46", "libelle": "Sorties et animations" }, { "cd_action": "167", "libelle": "Animations grand public" }],
    "date_deb": "2026-06-20", "date_fin": "2026-06-20", "date_deb_str": "20/06/2026", "date_fin_str": "20/06/2026",
    "detail": "Animation nature", "typ_interv": "REGB", "typ_interv_libelle": "Régie via bénévole", "com_interv": null, "validite": true,
    "localisations": [{ "cd_localisation": "…", "libelle": "Pré du Garde", "cat": "SITE CENCA", "code": "10…" }],
    "cibles":        [{ "typ_cible": "GP", "libelle": "Grand public", "detail": null }],
    "indicateurs":   [{ "uuid_indic": "…", "typ_indicateur": "NBPER", "libelle": "Nb personnes", "evaluation": "11" }],
    "intervenants":  [{ "typ_role": "MOUVR", "role_libelle": "Maitre d'ouvrage", "intervenant": "<uuid_ann>", "nom": "…" }]
  }]
}
```

`action_chemin` sert à afficher le fil d'Ariane de l'action et à préremplir les listes en cascade. **`GET operations/:uuid`** renvoie une opération au même format.

### Écriture (Bearer)

| Méthode | URL | Corps | Réponse |
|---|---|---|---|
| POST | `projets` | `{ nom, typ_projet, annee, statut?, responsable?, programme?, operations?: [opération…] }` | `201 { success, uuid_proj, projet }` |
| PUT | `projets/:uuid` | champs à modifier parmi `nom, typ_projet, annee, statut, responsable, programme` | `200 { success, uuid_proj, projet }` |
| DELETE | `projets/:uuid` | – | `200 { success, uuid_proj, operations_supprimees }` |
| POST | `projets/:uuid/operations` | une opération | `201 { success, uuid_ope, operation }` |
| PUT | `operations/:uuid` | champs à modifier + listes à remplacer | `200 { success, uuid_ope, operation }` |
| POST | `operations/:uuid/clone` | `{ date_deb?, date_fin?, projet? }` | `201 { success, uuid_ope, operation }` |
| DELETE | `operations/:uuid` | – | `200 { success, uuid_ope }` |

Une opération dans le corps :

```json
{ "action": "167", "date_deb": "2026-10-20", "date_fin": "2026-10-20", "detail": "…", "typ_interv": "REG", "com_interv": null,
  "localisations": ["<cd_localisation>", …],
  "cibles":        [{ "typ_cible": "GP", "detail": "classe de CM2" }],
  "indicateurs":   [{ "typ_indicateur": "NBPER", "evaluation": 15 }],
  "intervenants":  [{ "typ_role": "MOUVR", "intervenant": "<uuid_ann>" }] }
```

Règles appliquées par le backend :
- **Création d'un projet** : `nom`, `typ_projet` (ni TRV ni NR) et `annee` sont obligatoires. `statut` vaut « En cours » par défaut et `responsable` vaut l'utilisateur connecté par défaut. `createur` et `code` sont calculés.
- **Opérations envoyées avec le projet** : on peut créer le projet avec ses opérations en un seul POST. Tout est enregistré dans une seule transaction.
- **Action** : une action travaux (`004_TRAV`…) est refusée. Les travaux se saisissent dans le module travaux.
- **Listes en PUT** : une liste envoyée **remplace** entièrement l'ancienne, et `[]` la vide ; une liste absente n'est pas touchée. On peut donc envoyer le formulaire complet à chaque enregistrement. Chaque PUT est transactionnel.
- **Duplication** : `clone` copie l'opération et toutes ses listes, avec de nouvelles dates si on en fournit. Utile pour une animation répétée ou un suivi à plusieurs passages. `projet` copie l'opération dans un autre projet.
- **Suppressions** : tout utilisateur connecté peut supprimer un projet ou une opération, directement, avec les listes rattachées. C'est un choix assumé, différent de l'interface Access qui envoyait une demande au gestionnaire de l'outil. Pas de corbeille dans l'écran, mais un garde-fou côté serveur (point suivant).
- **Journal et sauvegarde** : chaque écriture est tracée dans `gestint.historiques` au format de l'interface Access (compte, date, table, uuid, action). Avant une suppression, le backend y écrit en plus une **copie complète** de ce qui disparaît (projet avec ses opérations et toutes leurs listes, ou opération seule), en JSON, dans une action `DELETE - Sauvegarde : {…}`. On sait donc toujours qui a supprimé quoi, et un administrateur peut restaurer. Rien à faire côté front, sauf le dire dans la confirmation.
- **Réponse des créations et modifications** : elle renvoie l'objet complet relu en base. Le front peut s'en servir directement, sans relire.

## Suppression et fiche ouverte par un collègue (à afficher)

Pendant la transition, l'interface MS Access et la webapp écrivent dans les mêmes tables. Deux règles, décidées le 2026-10-23 :

**Suppression directe, avec confirmation explicite.**
- Bouton « Supprimer » sur le projet et sur chaque opération, pour tout utilisateur connecté.
- Dialogue de confirmation qui rappelle ce qui part. Pour un projet : « Supprimer le projet *nom* et ses *N* opérations ? ». Pour une opération : son action et ses dates.
- Ajouter dans le dialogue : « La suppression est enregistrée à votre nom dans l'historique, avec une copie des données. »
- Après succès, retirer l'objet de l'écran et afficher un message ; en cas de `404`, il a déjà été supprimé (par un collègue) : recharger la liste.

**Fiche ouverte dans Access : on informe, on ne bloque pas.**
- L'interface Access pose un verrou dans `gestint.editions` quand un collègue ouvre une fiche projet en modification. `GET projets/:uuid` le renvoie dans `ouvert_par` (tableau vide si personne).
- Si `ouvert_par` n'est pas vide, afficher un bandeau d'avertissement en haut de la fiche, sans rien désactiver : « Ce projet est ouvert en modification dans Access par *Virginie Schmitt*. Vos modifications et les siennes peuvent s'écraser : coordonnez-vous. »
- Ignorer l'utilisateur connecté lui-même s'il apparaît dans la liste (il a peut-être Access ouvert à côté).
- Relire `ouvert_par` à l'ouverture de la fiche et juste avant l'enregistrement (`GET projets/:uuid`). S'il est apparu entre-temps, redemander confirmation avant d'envoyer le PUT.
- La webapp ne pose pas de verrou de son côté : un collègue sur Access ne voit pas qu'on modifie le projet dans la webapp. Un verrou peut aussi rester après un plantage d'Access : d'où un simple avertissement, jamais un blocage.

## Comportements de l'interface Access à reproduire

Tirés du code VBA des formulaires `2_opeaut_*` (ajout et modification de projet, sous-formulaire d'opération) :

- **Champs obligatoires du projet** : nom, année, responsable et statut. Access refuse d'enregistrer sans eux, et sans une action, au minimum de niveau 1, sur chaque opération. Les afficher comme obligatoires, même si le backend sait compléter responsable et statut.
- **Action en trois listes en cascade** : niveau 1, puis 2, puis 3. L'action enregistrée est **la plus profonde renseignée**. Changer un niveau vide les niveaux inférieurs. Le niveau 2 n'est actif qu'une fois le niveau 1 choisi.
- **Localisation pré-remplie** : quand le projet est créé depuis une **fiche site** (ou espace), la première opération reçoit automatiquement le site comme localisation. Côté webapp : `cd_localisation` = `uuid_espace` du site, à mettre dans `localisations` à la création de l'opération.
- **Choix d'un lieu** : catégorie d'abord (site CENCA, commune, N2000…), puis le lieu dans cette catégorie. Avec l'API : `GET localisants?cat=<cat>&q=…`.
- **Choix d'un intervenant en trois temps** : type de contact → contact de l'annuaire → rôle. Un bouton « nouveau contact » ouvre la fiche annuaire pour en créer un à la volée.
- **Cibles et indicateurs** : ajout ligne par ligne (liste + bouton « Ajouter »), chaque ligne ayant son bouton de suppression. Le détail d'une cible n'est saisissable qu'une fois la cible choisie, la valeur d'un indicateur qu'une fois l'indicateur choisi.
- **Retours à la ligne stockés « | »** (fonction `Formatage` d'Access) : dans le nom du projet, le détail et le commentaire d'intervention de l'opération, et le détail d'une cible, le backend remplace chaque retour à la ligne par `|`, fusionne les `||` et change la puce `•` en `-`. Les textes relus en contiennent donc, y compris ceux saisis dans Access (« Type executant : Scolaire | Nom executant : … »). À l'affichage, remplacer `|` par un saut de ligne. Dans un champ d'édition, convertir `|` en `\n` au chargement et envoyer le texte tel quel : le backend refait la conversion.
- **Doublons refusés** : même cible, même lieu, ou même intervenant avec le même rôle, deux fois sur une opération (le backend les refuse aussi).
- **Navigation** : Access fait défiler les opérations d'un projet avec « précédent / suivant ». Une liste des opérations sous l'en-tête du projet est plus pratique, l'essentiel est de garder la saisie de plusieurs opérations à la suite.

## Écrans à créer

1. **Recherche des projets autres** : même ergonomie que la recherche des projets travaux, avec les filtres année, type, responsable, statut et texte. Le tableau affiche le type (badge), le nom, les localisations, le nombre d'opérations, la période et le statut.
2. **Fiche projet** : l'en-tête du projet est éditable. En dessous, la liste des opérations, en cartes ou en tableau, avec les actions ajouter, modifier, dupliquer et supprimer.
3. **Formulaire d'opération** (dialogue ou panneau), dans cet ordre :
   - l'action, en trois listes en cascade, avec les branches conseillées en premier ;
   - les dates ;
   - les localisations : catégorie puis lieu, pré-remplies avec le site si on vient d'une fiche site ;
   - les cibles : publics pour SEN, PAR et ADM, écologiques groupées par `groupe` pour ETU, POL et ACC, avec un bouton pour basculer ;
   - les indicateurs : des lignes « indicateur + valeur », la première proposée selon le tableau des usages ;
   - les intervenants : type de contact, contact de l'annuaire, rôle ;
   - le détail et le mode d'intervention.
4. **Fiche site** : un onglet ou un bloc « Autres actions » alimenté par `GET projets?uuid_site=<uuid_site>`, avec un bouton « Nouveau projet » qui pré-remplit la localisation.

Les projets travaux ne changent pas : leurs routes (`sites/projets/…`, `sites/operations/…`, `sites/criteria_travaux/…`) restent les mêmes.
