# Exemples de questions à poser à Sonneur

Pour l'aide utilisateur du chatbot. Sonneur choisit lui-même l'outil à appeler : il suffit de poser la question en français, sans nommer l'outil. Chaque exemple ci-dessous correspond à un outil du MCP (`fonctions/clientMcp.js`, `OUTILS_AUTORISES`) et a été vérifié sur les données le 2026-10-20 (le 2026-10-23 pour les périmètres modifiés, mesures compensatoires, objectifs et habitats).

Conseils généraux :

- Désigner un site par son code (`10035`, `51BOIS01`) est le plus sûr ; son nom, même partiel et sans accents, marche aussi.
- Écrire les communes en toutes lettres (« Villechétif »). Ne pas donner de code INSEE : un nombre à 5 chiffres est pris pour un code de site.
- Un responsable se désigne par son prénom (« Aurore ») ou son code salarié (« AL »).
- « Depuis 2025 » = de 2025 à aujourd'hui ; « en 2025 » = cette année-là seulement.
- Une conversation compte au plus 10 questions. Les questions de suivi (« et dans l'Aube ? ») fonctionnent, mais reformuler une question complète donne des réponses plus fiables.

## Sites

### Rechercher des sites (`rechercher_sites`)

- Quels sont les sites gérés par Aurore ?
- Quels sont les 10 plus grands sites gérés par Virginie ?
- Quels sites contiennent « marais » dans leur nom ?
- Quels sites de tourbières et marais gère-t-on dans les Ardennes ?
- Quels sont les nouveaux sites de 2025 ?
- Quels sites sont entrés depuis 2020 dans la Marne ?
- Liste des sites gérés en Haute-Marne, du plus grand au plus petit.

### Sites d'une commune (`sites_par_commune`)

- Quels sites gère-t-on à Villechétif ?
- Y a-t-il des sites du CENCA à Saint-Dizier ?
- Quels sites se trouvent sur la commune des Riceys ?

### Sites autour d'un point GPS (`sites_autour_point`)

- Quels sites sont à moins de 2 km du point 48.30, 4.10 ?
- Le point GPS 49.76, 4.72 est-il dans un site du CENCA ?
- Quels sites trouve-t-on dans un rayon de 10 km autour de 48.95 N, 4.36 E ?

### Fiche d'un site (`fiche_site`)

- Fiche du site 10035.
- Qui est le responsable de la Pelouse de Champ Cognier ?
- Quels sont les conservateurs bénévoles du Marais de Villechétif ?
- Le site 08013 a-t-il un plan de gestion en cours ?
- Sur quelles communes s'étend le site 08013 ?

### Contour et surface d'un site (`geometrie_site`)

- Quelle est la surface cartographiée du site 10030 ?
- Le site 52134 a-t-il un contour cartographié ?

### Synthèse par type de site (`synthese_sites`)

- Combien de sites par type de site (gérés, assistance technique…) ?
- Nombre et surface des sites par type et par département.

## Chiffres clés et contrôle des données

### Indicateurs des sites, tableau de bord (`indicateurs_sites`)

- Combien de sites gérés et quelle surface totale ?
- Combien de nouveaux sites gérés en 2025 ?
- Chiffres clés à la fin de l'année dernière, pour le rapport d'activité.
- Nombre de sites et surface par département.
- Combien de sites sont en Natura 2000 ? Et en APB ?
- Répartition des sites par milieu naturel.
- Surface par type d'acte foncier à la fin de l'année dernière.
- Répartition des parcelles par type de propriétaire.
- Combien de sites par agence de l'eau ?
- Quels sites sont en réserve naturelle ?
- Combien de sites bénéficient d'une protection forte ?
- Combien de nouveaux sites par an depuis le début ?

### Indicateurs d'activité (`indicateurs_activite`)

- Combien d'animations l'année dernière, et combien de personnes sensibilisées ?
- Combien de scolaires et d'élus sensibilisés l'an dernier ?
- Quels plans de gestion ont été rédigés l'année dernière ?
- Combien de parcelles questionnées en animation foncière par département ?
- Animation foncière : parcelles questionnées par demandeur.

### Données incomplètes (`controle_donnees_sites`)

- Quels sites gérés n'ont pas de géométrie ?
- Quels sites gérés n'ont pas d'acte foncier en cours ?
- Quels sites ont des données manquantes (surface, milieu, commune…) ?

### Périmètres modifiés (`perimetres_modifies`)

- Quels sites ont changé de périmètre l'an dernier ?
- Quels sites ont vu leur contour modifié en 2024 ?

### Mesures compensatoires (`mesures_compensatoires`)

- Quelles mesures compensatoires suit-on ?
- Quelles mesures compensatoires sont liées aux carrières ?
- Quels sites sont concernés par la mesure compensatoire de la centrale photovoltaïque du Bois du Roi ?

## Maîtrise foncière

### Actes fonciers d'un site (`foncier_site`)

- Quels sont les actes fonciers du site 10035 ?
- Quand se termine la convention de la Pelouse de Champ Cognier ?
- Combien de parcelles et quelle surface sous maîtrise foncière sur le site 08013 ?
- Liste des parcelles du site 10030, avec leurs propriétaires (type).

### Échéances des actes (`echeances_actes`)

- Quels actes arrivent à échéance dans les 6 mois ?
- Quels actes arrivent à échéance d'ici 2 ans ?
- Quels actes sont échus depuis moins de 3 mois ?

## Projets et travaux

### Travaux d'un site (`travaux_site`)

- Quels travaux depuis 2025 à la Pelouse de Champ Cognier ?
- Quels travaux ont été faits sur le site 10001 en 2026 ?
- Historique des opérations de pâturage du site 10030.

### Rechercher des projets (`rechercher_projets`)

- Quels projets de travaux en 2026 ?
- Quels projets de TC sont en cours en 2026 ?
- Quels projets de pâturage en 2025 ?
- Projets du site 10035 depuis 2023.

### Détail d'un projet (`operations_projet`)

À poser après une recherche de projets, ou en décrivant le projet précisément :

- Détaille les opérations du projet de pâturage 2025 de la Pelouse de Champ Cognier : maître d'œuvre, financeurs, animaux.
- Qui a réalisé les travaux du projet « Milieu - Restaurer / Trait. végét » 2026 du site 10030 ?

### Bilan des opérations (`bilan_operations`)

- Bilan des travaux réalisés en 2025 par type d'action.
- Combien d'hectares pâturés chaque année depuis 2022 ?
- Bilan des opérations par site en 2025.
- Bilan des opérations du site 10030 depuis 2020.

### Objectifs des projets (`objectifs_projets`)

- Quels sont les objectifs de gestion du Marais de Villechétif ?
- Quels enjeux visent les projets 2025 de la Pelouse de Champ Cognier ?

## Habitats cartographiés

Relevés de végétation cartographiés depuis 2006, avec leur état de conservation. Une même zone peut avoir été relevée plusieurs années : Sonneur le précise quand il additionne des surfaces.

### Habitats d'un site (`habitats_site`)

- Quels habitats sur la Pelouse de Champ Cognier ?
- Quel est l'état de conservation des habitats du site 10030 ?
- Quelle part du Marais du Paradis est cartographiée, et en quelle année ?
- Quels habitats de zone humide trouve-t-on sur le site 08001 ?

### Synthèses de la cartographie (`habitats_cartographie`)

- Combien d'hectares d'habitats ont été cartographiés chaque année ?
- Quels sites gérés de l'Aube sont les moins cartographiés ?
- Sur quels sites trouve-t-on des phragmitaies ?
- Quelles sont les végétations de zone humide les plus cartographiées ?

## Observations naturalistes (WebObs)

Les données viennent d'un export WebObs (faune et flore depuis 2000), arrêté à une date que Sonneur indique dans sa réponse : les saisies plus récentes n'y sont pas. Les espèces sensibles apparaissent sous un nom masqué.

### Statistiques d'observations (`webobs_statistiques`)

- Combien d'observations par an depuis 2015 ?
- Combien d'observations d'oiseaux en 2025 ?
- Répartition des observations de 2024 par groupe (oiseaux, insectes, flore…).
- Combien d'observations en faune et en flore dans l'Aube ?
- Quelles communes de la Marne sont les plus prospectées pour les amphibiens ?
- Combien d'observateurs ont saisi des données en Haute-Marne en 2025 ?

### Espèces observées (`webobs_especes`)

- Quels reptiles sont les plus observés dans la Marne ?
- Quelles espèces protégées ont été vues à Givet ?
- Quels oiseaux menacés ont été observés en 2025 dans l'Aube ?
- Quelles espèces de la directive Habitats observe-t-on dans les Ardennes ?
- Quelles sont les espèces les moins observées en Haute-Marne ?
- Quelles espèces ont été vues le plus récemment à Chaumont ?
- Quels sont les statuts et la liste rouge du Sonneur à ventre jaune ?
- Depuis quand observe-t-on l'Oedicnème criard, et dans combien de communes ?

### Inventaire d'un site (`webobs_site`)

- Quelles espèces protégées ont été vues sur le site 10035 ?
- Inventaire des oiseaux de la Pelouse de Champ Cognier.
- Quelles espèces patrimoniales sur le site 08013 ?
- Combien d'espèces observées sur le site 10030 depuis 2020, par groupe ?
- Quelles espèces trouve-t-on dans un rayon de 200 m autour du site 52134 ?
- Quand a eu lieu la dernière observation sur le Marais de Villechétif ?

### Sites du CENCA et observations (`webobs_sites_cenca`)

- Sur quels sites trouve-t-on le Sonneur à ventre jaune ?
- Quels sont les sites gérés les plus riches en espèces ?
- Quels sites de la Marne comptent le plus d'espèces patrimoniales ?
- Quels sites comptent le plus d'espèces d'oiseaux ?
- Quels sites gérés sont les moins prospectés ?
- Sur quels sites a-t-on observé de la flore protégée depuis 2020 ?
- Quels sites de l'Aube ont eu une observation le plus récemment ?

## Ce que Sonneur ne fait pas

- Il ne modifie aucune donnée (lecture seule).
- Il n'écrit pas de requête SQL libre et ne fait pas de calcul spatial en dehors des outils ci-dessus (par exemple : croiser deux couches au choix, mesurer une distance entre deux sites).
- Il ne voit pas les saisies WebObs postérieures à l'export.
