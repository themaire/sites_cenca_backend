# Instructions pour Claude Code : saisie des projets « autres » (hors travaux)

> À donner en début de session Claude Code dans le dépôt front (`sites_cenca`), par exemple :
> « Lis `instructions_front_projets_autres.md` et crée la recherche et le formulaire des projets autres ».

## Pourquoi

La webapp ne sait saisir que les projets **travaux** (`typ_projet = 'TRV'`, schéma `opegerer`). Les collègues saisissent encore tous les autres types dans l'application MS Access historique : sensibilisation, études et suivis, police, foncier, partenariats, accompagnement, administratif, autre. Ils le font encore en 2026, dans le schéma `opeautres`.

Le backend expose maintenant ces projets sous `/sites/autres`. Le front doit offrir **une recherche** et **un formulaire projet + opérations**, distincts de ceux des travaux. Les données restent dans les tables Access : les projets saisis dans la webapp et ceux d'Access se lisent et se modifient indifféremment.

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

Toute action de l'arbre est acceptée, les nœuds intermédiaires compris, comme dans Access. Il vaut mieux faire choisir une feuille : une liste en cascade sur 2 ou 3 niveaux, ou un sélecteur arborescent avec recherche.

**`GET localisants?q=fepin`** (optionnel : `&cat=COM`, `&limite=50`, maximum 500) : autocomplétion des lieux, sans accents, sur le nom ou le code (code site, n° INSEE). Il faut au moins 2 caractères, sinon `400`.

```json
[{ "cd_localisation": "COMMUNE_0000000009728591", "code": "08166", "libelle": "FEPIN", "cat": "COM", "description": "Communes" }]
```

Valeurs de `cat` : `SITE CENCA`, `AUTRE CENCA`, `N2000`, `RN`, `AP`, `ZIE`, `PN`, `TMIL`, `CDL`, `RB`, `RAMSAR`, `TERR`, `COM`. Afficher `cat` en badge à côté du nom.

### Recherche

**`GET selectors`** : `{ annees: [2026, 2025…], responsables: [{ cd_type, libelle }], typ_projets: [...], statuts: [...] }` pour la barre de recherche (le type NR, « ancien format Access », y figure pour retrouver les anciens projets).

**`GET projets?annee=2026&typ_projet=SEN&responsable=VGS&statut=Terminé&texte=armoise&uuid_site=…&cd_localisation=…&limite=500`** : tous les paramètres sont facultatifs. `texte` cherche dans le nom du projet et le détail des opérations, sans accents. `uuid_site` sert pour l'onglet « autres actions » de la fiche site. Le tri se fait par année puis par date de création, en ordre décroissant ; limite par défaut 500, maximum 2000.

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
- **Suppressions** : elles sont définitives, sans corbeille, et suppriment les listes rattachées. Demander une confirmation, en rappelant le nombre d'opérations pour un projet.
- **Réponse des créations et modifications** : elle renvoie l'objet complet relu en base. Le front peut s'en servir directement, sans relire.

## Écrans à créer

1. **Recherche des projets autres** : même ergonomie que la recherche des projets travaux, avec les filtres année, type, responsable, statut et texte. Le tableau affiche le type (badge), le nom, les localisations, le nombre d'opérations, la période et le statut.
2. **Fiche projet** : l'en-tête du projet est éditable. En dessous, la liste des opérations, en cartes ou en tableau, avec les actions ajouter, modifier, dupliquer et supprimer.
3. **Formulaire d'opération** (dialogue ou panneau), dans cet ordre :
   - l'action, en cascade, avec les branches conseillées en premier ;
   - les dates ;
   - les localisations, en autocomplétion multiple ;
   - les cibles : publics pour SEN, PAR et ADM, écologiques groupées par `groupe` pour ETU, POL et ACC, avec un bouton pour basculer ;
   - les indicateurs : des lignes « indicateur + valeur », la première proposée selon le tableau des usages ;
   - les intervenants : contact de l'annuaire + rôle ;
   - le détail et le mode d'intervention.
4. **Fiche site** : un onglet ou un bloc « Autres actions » alimenté par `GET projets?uuid_site=<uuid_site>`.

Les projets travaux ne changent pas : leurs routes (`sites/projets/…`, `sites/operations/…`, `sites/criteria_travaux/…`) restent les mêmes.
