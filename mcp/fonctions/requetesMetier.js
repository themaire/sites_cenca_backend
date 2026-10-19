"use strict";

/**
 * Outils métier prédéfinis, repris des requêtes des routes du backend
 * (routes/sites/getSitesRoutes.js, fonctions/fonctionsSites.js) et paramétrés.
 * Voir documentation/base_sites_cenca.md pour le sens des tables.
 */

const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { LECTURE_SEULE, reponse, erreur, journaliser, lire, resultat } = require('./utilitaires');

const FICHIER_DOC = path.join(__dirname, '..', 'documentation', 'base_sites_cenca.md');

const schemaSite = z.string().min(1).describe('Code du site (ex. 51BOIS01) ou uuid_site');

/**
 * Déclare un outil en lecture seule avec journalisation et gestion d'erreur communes.
 */
function outil(server, nom, { title, description, inputSchema = {} }, traitement) {
  server.registerTool(nom, { title, description, inputSchema, annotations: LECTURE_SEULE }, async (args = {}) => {
    journaliser(nom, args);
    try {
      return await traitement(args);
    } catch (e) {
      return erreur(e.message);
    }
  });
}

/**
 * Retrouve un site par uuid ou par code. Lève une erreur explicite si absent ou ambigu.
 * @returns {Promise<{uuid_site: string, code: string, nom: string, espace: string}>}
 */
async function trouverSite(site) {
  const sites = await lire(`
    SELECT s.uuid_site, s.code, e.nom, s.espace, s.actuel, s.validite
    FROM sitcenca.sites s
    LEFT JOIN esp.espaces e ON e.uuid_espace = s.espace
    WHERE s.uuid_site = $1 OR upper(s.code) = upper($1)
    ORDER BY s.actuel DESC NULLS LAST`, [site.trim()]);
  if (sites.length === 0) {
    throw new Error(`Site "${site}" introuvable (ni code ni uuid_site). Utiliser rechercher_sites.`);
  }
  if (sites.length > 1) {
    throw new Error(`Plusieurs sites correspondent à "${site}" : ${JSON.stringify(sites)}. Rappeler l'outil avec l'uuid_site voulu.`);
  }
  return sites[0];
}

function enregistrerRequetesMetier(server) {

  // ---------------------------------------------------------------- Documentation
  outil(server, 'documentation_base', {
    title: 'Documentation de la base',
    description: "Guide métier de la base des sites du CENCA : schémas, tables principales, jointures (souvent non déclarées), codes, unités, pièges. À lire en début de conversation, avant d'écrire du SQL.",
  }, async () => ({ content: [{ type: 'text', text: fs.readFileSync(FICHIER_DOC, 'utf8') }] }));

  // ---------------------------------------------------------------- Sites
  outil(server, 'rechercher_sites', {
    title: 'Rechercher des sites',
    description: "Recherche des sites gérés (vue sitcenca.listesitescenca, celle de la barre de recherche de l'application) par texte (nom ou code, sans tenir compte des accents), type, commune, milieu naturel ou responsable.",
    inputSchema: {
      texte: z.string().optional().describe('Partie du nom ou du code du site'),
      typ_site: z.string().optional().describe('Code du type de site (cf. sitcenca.typ_sites)'),
      commune: z.string().optional().describe('Nom (partiel) ou code INSEE de commune'),
      milieu: z.string().optional().describe('Partie du libellé de milieu naturel'),
      responsable: z.string().optional().describe('Responsable du site (valeur de la colonne responsable)'),
      inclure_invalides: z.boolean().default(false).describe('Inclure les sites marqués validite = false'),
      limite: z.number().int().min(1).max(2000).default(200),
    },
  }, async ({ texte, typ_site, commune, milieu, responsable, inclure_invalides, limite }) => {
    const lignes = await lire(`
      SELECT uuid_site, code, nom, typ_site, typ_site_txt, statut, communes, insee, milieux_naturels,
             bassin_agence, responsable, prem_ctr, fin, alerte_fin, validite
      FROM sitcenca.listesitescenca
      WHERE ($1::text IS NULL OR unaccent(nom) ILIKE unaccent('%' || $1 || '%') OR code ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR typ_site = $2)
        AND ($3::text IS NULL OR unaccent(communes) ILIKE unaccent('%' || $3 || '%') OR insee ILIKE '%' || $3 || '%')
        AND ($4::text IS NULL OR unaccent(milieux_naturels) ILIKE unaccent('%' || $4 || '%'))
        AND ($5::text IS NULL OR responsable ILIKE '%' || $5 || '%')
        AND ($6::boolean OR validite IS NOT FALSE)
      ORDER BY code
      LIMIT $7`, [texte || null, typ_site || null, commune || null, milieu || null, responsable || null, inclure_invalides, limite]);
    return resultat(lignes);
  });

  outil(server, 'fiche_site', {
    title: "Fiche d'un site",
    description: "Tout sur un site : identité (site + espace), type, responsable, surfaces (déclarée et calculée sur la géométrie), centroïde WGS84, communes, conservateurs bénévoles, documents de gestion, actes de maîtrise foncière (résumé) et projets.",
    inputSchema: { site: schemaSite },
  }, async ({ site }) => {
    const { uuid_site, espace } = await trouverSite(site);

    const [identite] = await lire(`
      SELECT s.uuid_site, s.code, e.nom, s.typ_site, ts.libelle AS typ_site_libelle,
             s.responsable, concat_ws(' ', sal.prenom, sal.nom) AS responsable_nom,
             s.prem_ctr, s.ref_fcen, s.pourc_gere, s.surf_actes, s.parties_gerees, s.typ_ouverture,
             s.description_site, s.sensibilite, s.remq_sensibilite, s.ref_public, s.validite, s.actuel,
             s.url_cen, s.id_mnhn, s.url_mnhn, s.date_crea, s.modif_admin, s.ref_pmfu_id,
             e.uuid_espace, e.id_espace, e.surface AS surface_espace, e.typ_espace, e.zh, e.bassin_agence,
             e.typ_geologie, e.carto_hab
      FROM sitcenca.sites s
      LEFT JOIN esp.espaces e ON e.uuid_espace = s.espace
      LEFT JOIN sitcenca.typ_sites ts ON ts.cd_type = s.typ_site
      LEFT JOIN admin.salaries sal ON sal.cd_salarie = s.responsable
      WHERE s.uuid_site = $1`, [uuid_site]);

    const [geometrie] = await lire(`
      SELECT count(*) AS nb_geometries,
             round((sum(ST_Area(geom)) / 10000)::numeric, 4) AS surface_calculee_ha,
             ST_X(ST_Transform(ST_PointOnSurface(ST_Union(geom)), 4326)) AS longitude,
             ST_Y(ST_Transform(ST_PointOnSurface(ST_Union(geom)), 4326)) AS latitude
      FROM esp.geometries
      WHERE espace = $1 AND validite IS NOT FALSE AND geom IS NOT NULL`, [espace]);

    const [liste] = await lire(`
      SELECT statut, fin, alerte_fin, communes, insee, milieux_naturels
      FROM sitcenca.listesitescenca WHERE uuid_site = $1 LIMIT 1`, [uuid_site]);

    const communes = await lire(`
      SELECT loca.commune AS insee, com.nom
      FROM esp.localisations loca
      LEFT JOIN terr.listecommunes com ON com.insee_com = loca.commune
      WHERE loca.espace = $1
      ORDER BY com.nom`, [espace]);

    const conservateurs = await lire(`
      SELECT a.uuid_ann, a.nom, a.telephone, a.mail
      FROM sitcenca.conservateurs c
      JOIN ann.annuaire a ON a.uuid_ann = c.societe
      WHERE c.site = $1
      ORDER BY a.nom`, [uuid_site]);

    const documents = await lire(`
      SELECT d.uuid_doc, d.nom, t.libelle AS typ_document, d.annee_deb, d.annee_fin, d.actuel, d.surface, d.url
      FROM docplan.documents d
      LEFT JOIN docplan.typ_documents t ON t.cd_type = d.typ_document
      WHERE d.site = $1
      ORDER BY d.annee_deb DESC NULLS LAST`, [uuid_site]);

    const actes = await lire(`
      SELECT a.uuid_acte, a.typ_mfu, COALESCE(tm.libelle, a.typ_mfu) AS typ_mfu_libelle, a.debut, a.fin,
             a.tacit_rec, a.validite, a.actuel, a.site <> $1 AS acte_multisite_rattache
      FROM sitcenca.actes_mfu a
      LEFT JOIN sitcenca.typ_mfu tm ON tm.cd_type = a.typ_mfu
      WHERE a.site = $1
         OR EXISTS (SELECT 1 FROM sitcenca.actes_mfu_multi amm WHERE amm.ref_uuid_acte = a.uuid_acte AND amm.ref_uuid_site = $1)
      ORDER BY a.debut DESC NULLS LAST`, [uuid_site]);

    const projets = await lire(`
      SELECT p.uuid_proj, p.code, p.nom, p.annee, p.statut, p.typ_projet, p.pro_webapp,
             concat_ws(' ', sal.prenom, sal.nom) AS responsable_nom,
             (SELECT count(*) FROM opegerer.operations o WHERE o.ref_uuid_proj = p.uuid_proj) AS nb_operations
      FROM opegerer.projets p
      LEFT JOIN admin.salaries sal ON sal.cd_salarie = p.responsable
      WHERE p.site = $1
      ORDER BY p.annee DESC NULLS LAST`, [uuid_site]);

    return reponse({ ...identite, ...liste, geometrie, communes, conservateurs, documents_gestion: documents, actes_mfu: actes, projets });
  });

  outil(server, 'geometrie_site', {
    title: "Géométrie d'un site",
    description: "Contour du site en GeoJSON WGS84 (EPSG:4326), simplifié, avec la surface calculée en hectares. Pour une carte ou un calcul externe ; pour les calculs spatiaux, préférer le SQL PostGIS en 2154.",
    inputSchema: {
      site: schemaSite,
      tolerance_m: z.number().min(0).max(100).default(2).describe('Tolérance de simplification en mètres (0 = géométrie exacte)'),
    },
  }, async ({ site, tolerance_m }) => {
    const { uuid_site, code, nom, espace } = await trouverSite(site);
    const [{ geojson }] = await lire(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(json_agg(json_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(geom, $2), 4326), 6)::json,
          'properties', json_build_object('uuid_geom', uuid_geom, 'surface_ha', round((ST_Area(geom) / 10000)::numeric, 4),
                                          'typ_nature', typ_nature, 'annee_source', annee_source)
        )), '[]'::json)) AS geojson
      FROM esp.geometries
      WHERE espace = $1 AND validite IS NOT FALSE AND geom IS NOT NULL`, [espace, tolerance_m]);
    return reponse({ uuid_site, code, nom, geojson });
  });

  outil(server, 'sites_autour_point', {
    title: "Sites autour d'un point",
    description: "Sites dont la géométrie est à moins de rayon_m mètres d'un point GPS (WGS84), triés par distance. Distance 0 = le point est dans le site.",
    inputSchema: {
      longitude: z.number().min(-180).max(180),
      latitude: z.number().min(-90).max(90),
      rayon_m: z.number().min(0).max(50000).default(1000),
    },
  }, async ({ longitude, latitude, rayon_m }) => {
    const lignes = await lire(`
      WITH point AS (SELECT ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 2154) AS geom)
      SELECT s.uuid_site, s.code, e.nom, s.typ_site,
             round(min(ST_Distance(g.geom, point.geom))::numeric, 1) AS distance_m
      FROM esp.geometries g
      CROSS JOIN point
      JOIN esp.espaces e ON e.uuid_espace = g.espace
      JOIN sitcenca.sites s ON s.espace = e.uuid_espace
      WHERE g.validite IS NOT FALSE AND ST_DWithin(g.geom, point.geom, $3)
      GROUP BY s.uuid_site, s.code, e.nom, s.typ_site
      ORDER BY distance_m
      LIMIT 200`, [longitude, latitude, rayon_m]);
    return resultat(lignes);
  });

  outil(server, 'sites_par_commune', {
    title: 'Sites par commune',
    description: "Sites présents sur une commune (d'après esp.localisations), par nom de commune (accents et casse indifférents, nom partiel accepté) ou code INSEE. Préférer le nom : ne passer un code INSEE que s'il est connu avec certitude.",
    inputSchema: {
      commune: z.string().min(2).describe('Nom de la commune tel qu\'écrit par l\'utilisateur (ex. Villechetif), ou code INSEE connu'),
    },
  }, async ({ commune }) => {
    const lignes = await lire(`
      SELECT DISTINCT com.insee_com AS insee, com.nom AS commune, s.uuid_site, s.code, e.nom AS site, s.typ_site
      FROM esp.localisations loca
      JOIN terr.listecommunes com ON com.insee_com = loca.commune
      JOIN esp.espaces e ON e.uuid_espace = loca.espace
      JOIN sitcenca.sites s ON s.espace = e.uuid_espace
      WHERE com.insee_com = $1 OR unaccent(com.nom) ILIKE unaccent('%' || $1 || '%')
      ORDER BY com.nom, s.code`, [commune.trim()]);
    return resultat(lignes);
  });

  outil(server, 'synthese_sites', {
    title: 'Synthèse des sites',
    description: "Nombre de sites et surfaces (déclarée dans esp.espaces et calculée sur les géométries) par type de site, éventuellement par département (2 premiers chiffres de l'INSEE).",
    inputSchema: {
      par_departement: z.boolean().default(false),
      inclure_invalides: z.boolean().default(false),
    },
  }, async ({ par_departement, inclure_invalides }) => {
    const lignes = await lire(`
      WITH sites AS (
        SELECT s.uuid_site, s.espace, s.typ_site, ts.libelle AS typ_site_libelle, e.surface,
               CASE WHEN $1 THEN (SELECT string_agg(DISTINCT left(l.commune, 2), ', ') FROM esp.localisations l WHERE l.espace = s.espace) END AS departements
        FROM sitcenca.sites s
        LEFT JOIN esp.espaces e ON e.uuid_espace = s.espace
        LEFT JOIN sitcenca.typ_sites ts ON ts.cd_type = s.typ_site
        WHERE $2 OR s.validite IS NOT FALSE
      ), surfaces AS (
        SELECT espace, sum(ST_Area(geom)) / 10000 AS ha
        FROM esp.geometries WHERE validite IS NOT FALSE AND geom IS NOT NULL GROUP BY espace
      )
      SELECT sites.typ_site, sites.typ_site_libelle, sites.departements,
             count(*) AS nb_sites,
             round(sum(sites.surface)::numeric, 2) AS surface_declaree,
             round(sum(surfaces.ha)::numeric, 2) AS surface_calculee_ha
      FROM sites
      LEFT JOIN surfaces ON surfaces.espace = sites.espace
      GROUP BY 1, 2, 3
      ORDER BY 1, 3`, [par_departement, inclure_invalides]);
    return resultat(lignes);
  });

  // ---------------------------------------------------------------- Maîtrise foncière
  outil(server, 'foncier_site', {
    title: "Maîtrise foncière d'un site",
    description: "Actes de maîtrise foncière ou d'usage (MFU) d'un site, y compris les actes multi-sites, avec leurs parcelles résumées (nombre, surface par type de propriétaire). detail_parcelles = true pour la liste des parcelles.",
    inputSchema: {
      site: schemaSite,
      detail_parcelles: z.boolean().default(false),
    },
  }, async ({ site, detail_parcelles }) => {
    const { uuid_site, code, nom } = await trouverSite(site);

    const actes = await lire(`
      SELECT a.uuid_acte, a.typ_mfu, COALESCE(tm.libelle, a.typ_mfu) AS typ_mfu_libelle,
             a.debut, a.fin, a.tacit_rec, a.detail_rec, a.notaire, a.cout, a.remarque,
             a.validite, a.actuel, a.url, a.site AS site_principal,
             (a.fin IS NOT NULL AND a.fin < current_date) AS echu,
             (a.fin IS NOT NULL AND a.fin BETWEEN current_date AND current_date + interval '2 years') AS echeance_moins_2_ans
      FROM sitcenca.actes_mfu a
      LEFT JOIN sitcenca.typ_mfu tm ON tm.cd_type = a.typ_mfu
      WHERE a.site = $1
         OR EXISTS (SELECT 1 FROM sitcenca.actes_mfu_multi amm WHERE amm.ref_uuid_acte = a.uuid_acte AND amm.ref_uuid_site = $1)
      ORDER BY a.debut DESC NULLS LAST`, [uuid_site]);

    const syntheseParcelles = await lire(`
      SELECT p.acte_mfu AS uuid_acte, COALESCE(tp.libelle, p.typ_proprietaire) AS typ_proprietaire,
             count(*) AS nb_parcelles, sum(p.surface) AS surface,
             count(*) FILTER (WHERE p.pour_partie) AS nb_pour_partie
      FROM sitcenca.parcelles_mfu p
      LEFT JOIN sitcenca.typ_proprietaires tp ON tp.cd_type = p.typ_proprietaire
      WHERE p.acte_mfu = ANY($1::varchar[]) AND p.validite IS NOT FALSE
      GROUP BY 1, 2
      ORDER BY 1, 2`, [actes.map(a => a.uuid_acte)]);

    const parcelles = detail_parcelles ? await lire(`
      SELECT p.acte_mfu AS uuid_acte, p.code_parcelle, p.insee, p.prefix, p.section, p.numero, p.partie,
             p.surface, p.pour_partie, COALESCE(tp.libelle, p.typ_proprietaire) AS typ_proprietaire,
             p.proprietaire, p.remarque, p.validite
      FROM sitcenca.parcelles_mfu p
      LEFT JOIN sitcenca.typ_proprietaires tp ON tp.cd_type = p.typ_proprietaire
      WHERE p.acte_mfu = ANY($1::varchar[])
      ORDER BY p.insee, p.section, p.numero`, [actes.map(a => a.uuid_acte)]) : undefined;

    return reponse({ uuid_site, code, nom, actes, synthese_parcelles: syntheseParcelles, parcelles });
  });

  outil(server, 'echeances_actes', {
    title: 'Échéances des actes fonciers',
    description: "Actes MFU (conventions, baux…) arrivant à échéance dans les N mois, ou déjà échus depuis moins de N mois, tous sites confondus.",
    inputSchema: {
      mois: z.number().int().min(1).max(120).default(12),
      inclure_echus: z.boolean().default(true),
    },
  }, async ({ mois, inclure_echus }) => {
    const lignes = await lire(`
      SELECT a.fin, a.fin - current_date AS jours_restants, a.uuid_acte, COALESCE(tm.libelle, a.typ_mfu) AS typ_mfu,
             a.tacit_rec, a.detail_rec, s.code, e.nom AS site, a.validite, a.actuel
      FROM sitcenca.actes_mfu a
      LEFT JOIN sitcenca.typ_mfu tm ON tm.cd_type = a.typ_mfu
      LEFT JOIN sitcenca.sites s ON s.uuid_site = a.site
      LEFT JOIN esp.espaces e ON e.uuid_espace = s.espace
      WHERE a.fin IS NOT NULL AND a.validite IS NOT FALSE
        AND a.fin <= current_date + make_interval(months => $1)
        AND ($2 OR a.fin >= current_date)
        AND a.fin >= current_date - make_interval(months => $1)
      ORDER BY a.fin`, [mois, inclure_echus]);
    return resultat(lignes);
  });

  // ---------------------------------------------------------------- Travaux / gestion
  outil(server, 'rechercher_projets', {
    title: 'Rechercher des projets',
    description: "Projets de gestion (vue ope.listeprojets, comme la recherche de projets de l'application) par année, site, responsable, statut, type (TRV = travaux) ou texte du titre. Par défaut, seulement les projets saisis dans la webapp (pro_webapp) : les anciens projets MS Access n'ont pas d'opérations détaillées.",
    inputSchema: {
      annee: z.number().int().optional(),
      code_site: z.string().optional(),
      responsable: z.string().optional().describe('Valeur de la colonne responsable de ope.listeprojets'),
      statut: z.string().optional(),
      typ_projet: z.string().optional().describe("Type de projet, ex. 'TRV' pour les travaux"),
      texte: z.string().optional().describe('Partie du titre'),
      webapp_uniquement: z.boolean().default(true),
      limite: z.number().int().min(1).max(2000).default(200),
    },
  }, async ({ annee, code_site, responsable, statut, typ_projet, texte, webapp_uniquement, limite }) => {
    const lignes = await lire(`
      SELECT p.uuid_proj, p.annee, p.responsable, p.loc, p.titre, p.nb_ope, p.statut, p.typ_projet,
             s.code AS code_site, pr.pro_webapp
      FROM ope.listeprojets p
      LEFT JOIN opegerer.projets pr ON pr.uuid_proj = p.uuid_proj
      LEFT JOIN sitcenca.sites s ON s.uuid_site = pr.site
      WHERE ($1::int IS NULL OR p.annee = $1)
        AND ($2::text IS NULL OR upper(s.code) = upper($2))
        AND ($3::text IS NULL OR p.responsable ILIKE '%' || $3 || '%')
        AND ($4::text IS NULL OR p.statut = $4)
        AND ($5::text IS NULL OR p.typ_projet = $5)
        AND ($6::text IS NULL OR unaccent(p.titre) ILIKE unaccent('%' || $6 || '%'))
        AND (NOT $7 OR pr.pro_webapp IS TRUE)
      ORDER BY p.annee DESC NULLS LAST, s.code
      LIMIT $8`, [annee ?? null, code_site || null, responsable || null, statut || null, typ_projet || null, texte || null, webapp_uniquement, limite]);
    return resultat(lignes);
  });

  outil(server, 'operations_projet', {
    title: "Opérations d'un projet",
    description: "Opérations (interventions) d'un projet de gestion : type d'action, dates, quantités, surface, maître d'œuvre (annuaire), financeurs, animaux (pâturage), avec un indicateur de localisation cartographique.",
    inputSchema: {
      uuid_proj: z.string().min(1),
    },
  }, async ({ uuid_proj }) => {
    const lignes = await lire(`
      SELECT op.uuid_ope, op.code, op.titre, op.action, op.action_2,
             ope.get_action_libelle(op.action) AS action_libelle, ope.get_action_libelle(op.action_2) AS action_2_libelle,
             op.date_debut, op.date_fin, op.date_approx, op.quantite, opegerer.get_libelle(op.unite) AS unite,
             op.surf, op.lin, op.description, op.remarque, op.validite,
             op.ref_uuid_ann, COALESCE(mo.nom, op.nom_mo) AS maitre_oeuvre,
             (SELECT json_agg(opegerer.get_libelle(f.checkbox_id) ORDER BY opegerer.get_libelle(f.checkbox_id)) FROM opegerer.operation_financeurs f WHERE f.uuid_ope = op.uuid_ope) AS financeurs,
             op.financeur_description,
             (SELECT json_agg(opegerer.get_libelle(a.checkbox_id) ORDER BY opegerer.get_libelle(a.checkbox_id)) FROM opegerer.operation_animaux a WHERE a.uuid_ope = op.uuid_ope) AS animaux,
             EXISTS (SELECT 1 FROM opegerer.localisations l WHERE l.ref_uuid_ope = op.uuid_ope) AS localisee
      FROM opegerer.operations op
      LEFT JOIN ann.annuaire mo ON mo.uuid_ann = op.ref_uuid_ann
      WHERE op.ref_uuid_proj = $1
      ORDER BY op.date_debut NULLS LAST`, [uuid_proj]);
    return resultat(lignes);
  });

  outil(server, 'bilan_operations', {
    title: 'Bilan des opérations',
    description: "Agrège les opérations de gestion par type d'action (action_2), année et éventuellement site : nombre d'opérations, surface et linéaire cumulés, quantités par unité. Filtres optionnels : années, site, action.",
    inputSchema: {
      annee_debut: z.number().int().optional(),
      annee_fin: z.number().int().optional(),
      code_site: z.string().optional(),
      action: z.string().optional().describe("Code d'action (ope.actions.cd_action), comparé à action et action_2"),
      par_site: z.boolean().default(false),
    },
  }, async ({ annee_debut, annee_fin, code_site, action, par_site }) => {
    const lignes = await lire(`
      SELECT extract(year FROM op.date_debut)::int AS annee,
             CASE WHEN $5 THEN s.code END AS code_site,
             op.action_2, ope.get_action_libelle(op.action_2) AS action_2_libelle,
             opegerer.get_libelle(op.unite) AS unite,
             count(*) AS nb_operations, sum(op.surf) AS surface, sum(op.lin) AS lineaire, sum(op.quantite) AS quantite
      FROM opegerer.operations op
      JOIN opegerer.projets p ON p.uuid_proj = op.ref_uuid_proj
      LEFT JOIN sitcenca.sites s ON s.uuid_site = p.site
      WHERE op.validite IS NOT FALSE
        AND ($1::int IS NULL OR op.date_debut >= make_date($1, 1, 1))
        AND ($2::int IS NULL OR op.date_debut < make_date($2 + 1, 1, 1))
        AND ($3::text IS NULL OR upper(s.code) = upper($3))
        AND ($4::text IS NULL OR op.action = $4 OR op.action_2 = $4)
      GROUP BY 1, 2, 3, 4, 5
      ORDER BY 1 DESC NULLS LAST, 2, 4`, [annee_debut ?? null, annee_fin ?? null, code_site || null, action || null, par_site]);
    return resultat(lignes);
  });
}

module.exports = { enregistrerRequetesMetier };
