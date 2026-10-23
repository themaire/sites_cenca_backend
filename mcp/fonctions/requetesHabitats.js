"use strict";

/**
 * Habitats naturels cartographiés (schéma hab de la base des sites), d'après les requêtes de
 * ressources/bdd/exemples_sql.json (surface relevée par année, pourcentage cartographié par site).
 *
 * hab.fiches_releves : un polygone de végétation par relevé (Lambert 93), son année (dateReleve),
 * l'intitulé de la végétation, l'état de conservation (hab.typ_etatcons), zone humide (1 = oui).
 * Les campagnes se superposent : une même zone relevée deux années compte deux fois dans une somme,
 * d'où une surface cartographiée calculée sur l'union des polygones.
 * hab.pourcentage_carto (vue) : part de chaque espace couverte par des relevés, en %.
 */

const { z } = require('zod');
const { reponse, lire, resultat, contientTexte } = require('./utilitaires');
const { outil, trouverSiteParNom, numeroDepartement } = require('./requetesMetier');

const HA = expr => `round((${expr} / 10000)::numeric, 2)`;

// Sites gérés actuels (comme webobs_sites_cenca), contour = union de leurs géométries valides
const SITES_GERES = `
  SELECT s.uuid_site, s.code, e.nom, s.espace, ST_Union(g.geom) AS geom
  FROM sitcenca.sites s
  JOIN esp.espaces e ON e.uuid_espace = s.espace
  JOIN esp.geometries g ON g.espace = s.espace AND g.validite IS NOT FALSE
  WHERE s.typ_site = '1' AND s.actuel IS NOT FALSE AND s.validite IS NOT FALSE
    AND ($1::text IS NULL OR left(s.code, 2) = $1)
  GROUP BY s.uuid_site, s.code, e.nom, s.espace`;

function enregistrerRequetesHabitats(server) {

  outil(server, 'habitats_site', {
    title: "Habitats cartographiés d'un site",
    description: "Habitats naturels (végétations) cartographiés dans l'emprise d'un site : surface du site, surface cartographiée et pourcentage, années des relevés, surface en zone humide, "
      + "répartition par état de conservation (bon, altéré, dégradé, inconnu), puis la liste des végétations avec leur surface dans le site, leurs années et leur état. "
      + "site = code, uuid_site ou nom (même partiel). annee = une seule campagne de relevés. "
      + "Ex. : « Quels habitats sur la Pelouse de Champ Cognier ? », « État de conservation des habitats du site 10035 ». Pour la faune et la flore observées, utiliser webobs_site.",
    inputSchema: {
      site: z.string().min(2).describe('Code (ex. 10030), uuid_site ou nom du site'),
      annee: z.number().int().min(1990).max(2100).optional().describe('Année de relevé (par défaut toutes les campagnes)'),
      limite: z.number().int().min(1).max(300).default(60).describe('Nombre maximum de végétations listées'),
    },
  }, async ({ site, annee, limite }) => {
    const s = await trouverSiteParNom(site);
    const releves = `
      WITH emprise AS (SELECT ST_Union(g.geom) AS geom FROM esp.geometries g WHERE g.espace = $1 AND g.validite IS NOT FALSE),
      rel AS (
        SELECT r."intituleVegetation" AS vegetation, r."dateReleve"::int AS annee, r."zoneHumide" AS zone_humide, r."idEtat",
               ST_Intersection(r."geomReleve", e.geom) AS geom
        FROM hab.fiches_releves r, emprise e
        WHERE ST_Intersects(r."geomReleve", e.geom) AND ($2::int IS NULL OR r."dateReleve" = $2)
      )`;
    const [[synthese], etats, vegetations] = await Promise.all([
      lire(`${releves}
        SELECT ${HA('ST_Area(e.geom)')} AS surface_site_ha,
               (SELECT ${HA('ST_Area(ST_Union(geom))')} FROM rel) AS surface_cartographiee_ha,
               (SELECT count(*) FROM rel) AS nb_polygones,
               (SELECT count(DISTINCT vegetation) FROM rel) AS nb_vegetations,
               (SELECT min(annee) FROM rel) AS premier_releve, (SELECT max(annee) FROM rel) AS dernier_releve,
               (SELECT array_agg(DISTINCT annee ORDER BY annee) FROM rel) AS annees_releves,
               (SELECT ${HA('ST_Area(ST_Union(geom))')} FROM rel WHERE zone_humide = 1) AS surface_zone_humide_ha
        FROM emprise e`, [s.espace, annee ?? null]),
      lire(`${releves}
        SELECT coalesce(et."intituleEtat", 'Inconnu') AS etat, count(*) AS nb_polygones, ${HA('sum(ST_Area(rel.geom))')} AS surface_ha
        FROM rel LEFT JOIN hab.typ_etatcons et ON et."idEtat" = rel."idEtat"
        GROUP BY 1 ORDER BY surface_ha DESC`, [s.espace, annee ?? null]),
      lire(`${releves}
        SELECT vegetation, count(*) AS nb_polygones, ${HA('sum(ST_Area(rel.geom))')} AS surface_ha,
               min(annee) AS premiere_annee, max(annee) AS derniere_annee,
               string_agg(DISTINCT coalesce(et."intituleEtat", 'Inconnu'), ', ') AS etats,
               bool_or(zone_humide = 1) AS zone_humide
        FROM rel LEFT JOIN hab.typ_etatcons et ON et."idEtat" = rel."idEtat"
        GROUP BY vegetation ORDER BY surface_ha DESC, vegetation
        LIMIT $3`, [s.espace, annee ?? null, limite]),
    ]);
    if (synthese.surface_site_ha === null) throw new Error(`Le site ${s.code || s.uuid_site} (${s.nom}) n'a pas de géométrie : impossible de croiser avec les habitats.`);
    const couverture = Number(synthese.surface_site_ha) > 0 && synthese.surface_cartographiee_ha !== null
      ? Math.round(Number(synthese.surface_cartographiee_ha) / Number(synthese.surface_site_ha) * 100) : 0;
    return reponse({
      site: { uuid_site: s.uuid_site, code: s.code, nom: s.nom },
      annee: annee ?? 'toutes',
      synthese: { ...synthese, pourcentage_cartographie: couverture },
      par_etat_conservation: etats,
      nb_vegetations_listees: vegetations.length,
      vegetations,
      note: annee ? undefined : 'Surfaces par végétation et par état additionnées sur toutes les campagnes : une zone relevée plusieurs années compte plusieurs fois (la surface cartographiée, elle, est calculée sans doublon).',
    });
  });

  outil(server, 'habitats_cartographie', {
    title: 'Cartographie des habitats',
    description: "Synthèses de la cartographie des habitats naturels (relevés de végétation depuis 2006). regroupement : "
      + "annee = surface relevée et nombre de polygones par année de campagne ; "
      + "site = sites gérés avec leur surface et le pourcentage cartographié (tri : plus_cartographies ou moins_cartographies), ou, si vegetation est donné, les sites où cette végétation est cartographiée et sa surface ; "
      + "vegetation = types de végétation les plus cartographiés (surface, nombre de polygones, années). "
      + "Filtres : vegetation (partie de l'intitulé, ex. « pelouse », « phragmitaie », « aulnaie »), zone_humide, departement (sites). "
      + "Ex. : « Combien d'hectares d'habitats cartographiés par an ? », « Quels sites gérés sont les moins cartographiés ? », « Sur quels sites trouve-t-on des pelouses calcicoles ? ». Pour le détail d'un site, utiliser habitats_site.",
    inputSchema: {
      regroupement: z.enum(['annee', 'site', 'vegetation']).default('annee'),
      vegetation: z.string().min(3).optional().describe("Partie de l'intitulé de la végétation (ex. pelouse calcicole, phragmitaie)"),
      zone_humide: z.boolean().optional().describe('true = seulement les végétations de zone humide'),
      departement: z.string().optional().describe('Département des sites : 08, 10, 51, 52 ou leur nom (regroupement site)'),
      tri: z.enum(['plus_cartographies', 'moins_cartographies']).default('plus_cartographies').describe('Regroupement site sans végétation : ordre du pourcentage cartographié'),
      limite: z.number().int().min(1).max(400).default(50),
    },
  }, async ({ regroupement, vegetation, zone_humide, departement, tri, limite }) => {
    // Filtres sur les relevés : végétation et zone humide, aux paramètres $v et $z
    const filtreReleve = (v, zh) => `(${v}::text IS NULL OR ${contientTexte('r."intituleVegetation"', v)}) AND (${zh}::boolean IS NULL OR (r."zoneHumide" = 1) = ${zh})`;
    const dep = numeroDepartement(departement) || null;

    if (regroupement === 'annee') {
      const lignes = await lire(`
        SELECT r."dateReleve"::int AS annee, count(*) AS nb_polygones, count(DISTINCT r."intituleVegetation") AS nb_vegetations,
               ${HA('sum(ST_Area(r."geomReleve"))')} AS surface_ha
        FROM hab.fiches_releves r
        WHERE ${filtreReleve('$1', '$2')}
        GROUP BY 1 ORDER BY 1`, [vegetation || null, zone_humide ?? null]);
      return resultat(lignes, { regroupement, vegetation, zone_humide });
    }

    if (regroupement === 'vegetation') {
      const lignes = await lire(`
        SELECT r."intituleVegetation" AS vegetation, count(*) AS nb_polygones, ${HA('sum(ST_Area(r."geomReleve"))')} AS surface_ha,
               min(r."dateReleve")::int AS premiere_annee, max(r."dateReleve")::int AS derniere_annee, bool_or(r."zoneHumide" = 1) AS zone_humide
        FROM hab.fiches_releves r
        WHERE ${filtreReleve('$1', '$2')}
        GROUP BY 1 ORDER BY surface_ha DESC, vegetation
        LIMIT $3`, [vegetation || null, zone_humide ?? null, limite]);
      return resultat(lignes, { regroupement, vegetation, zone_humide });
    }

    if (vegetation || zone_humide !== undefined) {
      // Sites gérés où des végétations correspondant au filtre sont cartographiées
      const lignes = await lire(`
        WITH sites AS (${SITES_GERES})
        SELECT s.code, s.nom, s.uuid_site, count(*) AS nb_polygones,
               ${HA('sum(ST_Area(ST_Intersection(r."geomReleve", s.geom)))')} AS surface_ha,
               max(r."dateReleve")::int AS dernier_releve,
               (array_agg(DISTINCT r."intituleVegetation"))[1:5] AS vegetations
        FROM sites s
        JOIN hab.fiches_releves r ON ST_Intersects(r."geomReleve", s.geom) AND ${filtreReleve('$2', '$3')}
        GROUP BY s.code, s.nom, s.uuid_site
        ORDER BY surface_ha DESC, s.code
        LIMIT $4`, [dep, vegetation || null, zone_humide ?? null, limite]);
      return resultat(lignes, { regroupement, vegetation, zone_humide, departement: dep });
    }

    // Pourcentage cartographié par site (vue hab.pourcentage_carto)
    const lignes = await lire(`
      WITH sites AS (${SITES_GERES})
      SELECT s.code, s.nom, s.uuid_site, ${HA('ST_Area(s.geom)')} AS surface_ha, coalesce(p.pourcentage, 0) AS pourcentage_cartographie,
             ${HA('ST_Area(s.geom) * coalesce(p.pourcentage, 0) / 100')} AS surface_cartographiee_ha
      FROM sites s
      LEFT JOIN hab.pourcentage_carto p ON p.uuid_espace = s.espace
      ORDER BY coalesce(p.pourcentage, 0) ${tri === 'moins_cartographies' ? 'ASC' : 'DESC'}, surface_ha DESC
      LIMIT $2`, [dep, limite]);
    const [total] = await lire(`
      WITH sites AS (${SITES_GERES})
      SELECT count(*) AS sites_geres, count(*) FILTER (WHERE p.pourcentage > 0) AS sites_cartographies,
             count(*) FILTER (WHERE p.pourcentage >= 90) AS sites_cartographies_a_90_pct
      FROM sites s LEFT JOIN hab.pourcentage_carto p ON p.uuid_espace = s.espace`, [dep]);
    return resultat(lignes, { regroupement, departement: dep, tri, ...total });
  });
}

module.exports = { enregistrerRequetesHabitats };
