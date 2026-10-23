"use strict";

/**
 * Outils métier prédéfinis, repris des requêtes des routes du backend
 * (routes/sites/getSitesRoutes.js, fonctions/fonctionsSites.js) et paramétrés.
 * Voir documentation/base_sites_cenca.md pour le sens des tables.
 */

const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { LECTURE_SEULE, reponse, erreur, journaliser, lire, resultat, contientTexte } = require('./utilitaires');

const FICHIER_DOC = path.join(__dirname, '..', 'documentation', 'base_sites_cenca.md');

// « Aube », « 10 », « 8 » → « 10 », « 08 » (départements de Champagne-Ardenne)
const DEPARTEMENTS = { ardennes: '08', aube: '10', marne: '51', 'haute-marne': '52', 'haute marne': '52' };
function numeroDepartement(valeur) {
  if (!valeur) return null;
  const texte = String(valeur).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (DEPARTEMENTS[texte]) return DEPARTEMENTS[texte];
  const chiffres = texte.match(/^\d{1,2}$/);
  return chiffres ? chiffres[0].padStart(2, '0') : texte;
}

const schemaSite = z.string().min(1).describe('Code du site (ex. 10035, 51BOIS01), uuid_site ou nom du site (même partiel, sans accents)');

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

/** Équivalent JS de texteNormalise (SQL), pour comparer un nom saisi à un nom lu en base */
function normaliser(texte) {
  return String(texte).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bste\b/g, 'sainte').replace(/\bst\b/g, 'saint').trim();
}

/**
 * Comme trouverSite, mais accepte aussi un nom de site (même partiel, sans accents ni casse).
 */
async function trouverSiteParNom(site) {
  const brut = site.trim();
  if (/^[0-9A-Za-z]{5,8}$/.test(brut) || /^[0-9A-Fa-f-]{36}$/.test(brut)) {
    try { return await trouverSite(brut); } catch { /* pas un code : recherche par nom */ }
  }
  // « la pelouse de champ cognier », « site du marais de Reuves » : article ou « site » en tête retirés
  const texte = brut.replace(/^(?:(?:le|la|les|l'|l’|du|des|de la|de l'|au|aux|site|sites)\s*)+/i, '').trim() || brut;
  const chercher = (condition, valeurs) => lire(`
    SELECT s.uuid_site, s.code, e.nom, s.espace
    FROM sitcenca.sites s
    JOIN esp.espaces e ON e.uuid_espace = s.espace
    WHERE s.validite IS NOT FALSE AND ${condition}
    ORDER BY s.actuel IS NOT FALSE DESC, s.typ_site, e.nom
    LIMIT 10`, valeurs);
  let sites = await chercher(contientTexte('e.nom', '$1'), [texte]);
  if (sites.length === 0) {
    // Sinon tous les mots significatifs (3 lettres ou plus), dans n'importe quel ordre
    const mots = texte.split(/[\s'’-]+/).filter(m => m.length >= 3);
    if (mots.length) sites = await chercher(mots.map((_, i) => contientTexte('e.nom', `$${i + 1}`)).join(' AND '), mots);
  }
  if (sites.length === 0) throw new Error(`Aucun site ne correspond à "${site}". Utiliser rechercher_sites.`);
  const exact = sites.filter(x => normaliser(x.nom) === normaliser(texte));
  if (sites.length > 1 && exact.length !== 1) {
    throw new Error(`Plusieurs sites correspondent à "${site}" : ${sites.map(x => `${x.code || x.uuid_site} ${x.nom}`).join(' ; ')}. Rappeler l'outil avec le code du site voulu.`);
  }
  return exact[0] || sites[0];
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
    description: "Recherche des sites gérés (vue sitcenca.listesitescenca, celle de la barre de recherche de l'application) par texte (nom ou code, sans tenir compte des accents), type, commune, milieu naturel, responsable ou année de premier contrat (prem_ctr = année d'entrée du site, « nouveaux sites » d'une année). Renvoie la surface de chaque site (surface_ha, calculée sur la géométrie) ; tri = 'surface' pour les plus grands d'abord. Ne pas passer une année dans texte : utiliser annee_premier_contrat ou premier_contrat_depuis.",
    inputSchema: {
      texte: z.string().optional().describe('Partie du nom ou du code du site'),
      typ_site: z.string().optional().describe('Code du type de site (cf. sitcenca.typ_sites)'),
      commune: z.string().optional().describe('Nom (partiel) ou code INSEE de commune'),
      milieu: z.string().optional().describe('Partie du libellé de milieu naturel'),
      responsable: z.string().optional().describe('Responsable du site : code salarié (ex. AL) ou prénom / nom (ex. Aurore)'),
      departement: z.string().optional().describe('Département : 08 (Ardennes), 10 (Aube), 51 (Marne) ou 52 (Haute-Marne)'),
      annee_premier_contrat: z.number().int().min(1900).max(2100).optional().describe("Année exacte du premier contrat (nouveaux sites de cette année), ex. 2025"),
      premier_contrat_depuis: z.number().int().min(1900).max(2100).optional().describe("Premier contrat cette année-là ou après, ex. 2020"),
      tri: z.enum(['code', 'surface']).default('code').describe("Ordre des résultats : 'surface' = plus grands sites d'abord (surface calculée sur la géométrie)"),
      inclure_invalides: z.boolean().default(false).describe('Inclure les sites marqués validite = false'),
      limite: z.number().int().min(1).max(2000).default(200),
    },
  }, async ({ texte, typ_site, commune, milieu, responsable, departement, annee_premier_contrat, premier_contrat_depuis, tri, inclure_invalides, limite }) => {
    const lignes = await lire(`
      SELECT uuid_site, code, nom, typ_site, typ_site_txt, statut, communes, insee, milieux_naturels,
             bassin_agence, responsable,
             (SELECT concat_ws(' ', sal.prenom, sal.nom) FROM admin.salaries sal WHERE sal.cd_salarie = responsable) AS responsable_nom,
             prem_ctr, fin, alerte_fin, validite, surf.surface_ha
      FROM sitcenca.listesitescenca
      LEFT JOIN LATERAL (
        SELECT round((sum(ST_Area(g.geom)) / 10000)::numeric, 2) AS surface_ha
        FROM esp.geometries g
        WHERE g.espace = listesitescenca.espace AND g.validite IS NOT FALSE AND g.geom IS NOT NULL
      ) surf ON true
      WHERE ($1::text IS NULL OR ${contientTexte('nom', '$1')} OR code ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR typ_site = $2)
        AND ($3::text IS NULL OR ${contientTexte('communes', '$3')} OR insee ILIKE '%' || $3 || '%')
        AND ($4::text IS NULL OR ${contientTexte('milieux_naturels', '$4')})
        AND ($5::text IS NULL OR upper(responsable) = upper($5) OR responsable IN (
              SELECT cd_salarie FROM admin.salaries
              WHERE unaccent(prenom) ILIKE unaccent($5) OR unaccent(nom) ILIKE unaccent($5)
                 OR unaccent(concat_ws(' ', prenom, nom)) ILIKE unaccent($5)))
        AND ($6::boolean OR validite IS NOT FALSE)
        AND ($8::int IS NULL OR prem_ctr = $8)
        AND ($9::int IS NULL OR prem_ctr >= $9)
        -- Département : d'après l'INSEE des communes s'il est renseigné, sinon le préfixe du code site
        AND ($10::text IS NULL OR CASE WHEN coalesce(insee, '') <> '' THEN insee ~ ('(^|\\|)' || $10)
                                      ELSE left(code, 2) = $10 END)
      ORDER BY CASE WHEN $11 = 'surface' THEN surf.surface_ha END DESC NULLS LAST, code
      LIMIT $7`, [texte || null, typ_site || null, commune || null, milieu || null, responsable || null, inclure_invalides, limite,
                  annee_premier_contrat ?? null, premier_contrat_depuis ?? null, numeroDepartement(departement), tri]);
    return resultat(lignes);
  });

  outil(server, 'fiche_site', {
    title: "Fiche d'un site",
    description: "Tout sur un site : identité (site + espace), type, responsable, surfaces (déclarée et calculée sur la géométrie), centroïde WGS84, communes, conservateurs bénévoles, documents de gestion, actes de maîtrise foncière (résumé) et projets.",
    inputSchema: { site: schemaSite },
  }, async ({ site }) => {
    const { uuid_site, espace } = await trouverSiteParNom(site);

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
    const { uuid_site, code, nom, espace } = await trouverSiteParNom(site);
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
      WHERE com.insee_com = $1 OR ${contientTexte('com.nom', '$1')}
      ORDER BY com.nom, s.code`, [commune.trim()]);
    return resultat(lignes);
  });

  outil(server, 'synthese_sites', {
    title: 'Synthèse des sites',
    description: "Nombre de sites et surfaces (déclarée dans esp.espaces et calculée sur les géométries) par type de site, éventuellement par département (2 premiers chiffres de l'INSEE). Compte aussi les sites non actuels : pour les chiffres officiels des sites gérés (rapport d'activité, tableau de bord), utiliser indicateurs_sites.",
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
    description: "Actes de maîtrise foncière ou d'usage (MFU) d'un site, avec dates de début et de fin, échéances (échu, échéance à moins de 2 ans), y compris les actes multi-sites, avec leurs parcelles résumées (nombre, surface par type de propriétaire). detail_parcelles = true pour la liste des parcelles.",
    inputSchema: {
      site: schemaSite,
      detail_parcelles: z.boolean().default(false),
    },
  }, async ({ site, detail_parcelles }) => {
    const { uuid_site, code, nom } = await trouverSiteParNom(site);

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
    description: "Actes MFU (conventions, baux…) arrivant à échéance dans les N mois, ou déjà échus depuis moins de N mois, tous sites confondus. Pour les actes d'un seul site, utiliser foncier_site.",
    inputSchema: {
      mois: z.number().int().min(1).max(120).default(12),
      inclure_echus: z.boolean().default(true),
    },
  }, async ({ mois, inclure_echus }) => {
    const lignes = await lire(`
      SELECT a.fin, a.fin - current_date AS jours_restants, a.uuid_acte, COALESCE(tm.libelle, a.typ_mfu) AS typ_mfu,
             a.tacit_rec, a.detail_rec, s.uuid_site, s.code, e.nom AS site, a.validite, a.actuel
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
    description: "Projets de gestion (vue ope.listeprojets, comme la recherche de projets de l'application) par année (ou période annee_debut / annee_fin, ex. « depuis 2025 » = annee_debut 2025), site, responsable, statut, type (TRV = travaux) ou texte du titre. Par défaut, seulement les projets saisis dans la webapp (pro_webapp) : les anciens projets MS Access n'ont pas d'opérations détaillées.",
    inputSchema: {
      annee: z.number().int().optional().describe('Une seule année'),
      annee_debut: z.number().int().optional().describe('Première année incluse (période)'),
      annee_fin: z.number().int().optional().describe('Dernière année incluse (période)'),
      code_site: z.string().optional(),
      responsable: z.string().optional().describe('Valeur de la colonne responsable de ope.listeprojets'),
      statut: z.string().optional(),
      typ_projet: z.string().optional().describe("Type de projet, ex. 'TRV' pour les travaux"),
      texte: z.string().optional().describe('Partie du titre'),
      webapp_uniquement: z.boolean().default(true),
      limite: z.number().int().min(1).max(2000).default(200),
    },
  }, async ({ annee, annee_debut, annee_fin, code_site, responsable, statut, typ_projet, texte, webapp_uniquement, limite }) => {
    const lignes = await lire(`
      SELECT p.uuid_proj, p.annee, p.responsable, p.loc, p.titre, p.nb_ope, p.statut, p.typ_projet,
             s.uuid_site, s.code AS code_site, pr.pro_webapp
      FROM ope.listeprojets p
      LEFT JOIN opegerer.projets pr ON pr.uuid_proj = p.uuid_proj
      LEFT JOIN sitcenca.sites s ON s.uuid_site = pr.site
      WHERE ($1::int IS NULL OR p.annee = $1)
        AND ($2::text IS NULL OR upper(s.code) = upper($2))
        AND ($3::text IS NULL OR p.responsable ILIKE '%' || $3 || '%')
        AND ($9::int IS NULL OR p.annee >= $9)
        AND ($10::int IS NULL OR p.annee <= $10)
        AND ($4::text IS NULL OR p.statut = $4)
        AND ($5::text IS NULL OR p.typ_projet = $5)
        AND ($6::text IS NULL OR ${contientTexte('p.titre', '$6')})
        AND (NOT $7 OR pr.pro_webapp IS TRUE)
      ORDER BY p.annee DESC NULLS LAST, s.code
      LIMIT $8`, [annee ?? null, code_site || null, responsable || null, statut || null, typ_projet || null, texte || null, webapp_uniquement, limite,
        annee_debut ?? null, annee_fin ?? null]);
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

  outil(server, 'travaux_site', {
    title: "Travaux d'un site",
    description: "Tous les projets de gestion d'un site et leurs opérations (travaux réalisés ou prévus), en un seul appel : année, titre, statut, puis pour chaque opération l'action, les dates, la quantité, la surface, le maître d'œuvre et un résumé de la description ; bilan_par_annee_et_action donne les totaux exacts. "
      + "site = code, uuid_site ou nom du site (même partiel, sans accents). Période : annee_debut / annee_fin (« depuis 2025 » = annee_debut 2025). "
      + "Ex. : « Quels travaux depuis 2025 à la Pelouse de Champ Cognier ? ». Pour plusieurs sites ou un bilan chiffré, utiliser bilan_operations.",
    inputSchema: {
      site: z.string().min(2).describe('Code (ex. 10030), uuid_site ou nom du site'),
      annee_debut: z.number().int().optional().describe('Première année incluse'),
      annee_fin: z.number().int().optional().describe('Dernière année incluse'),
    },
  }, async ({ site, annee_debut, annee_fin }) => {
    const s = await trouverSiteParNom(site);
    const lignes = await lire(`
      SELECT p.uuid_proj, l.annee, l.titre, l.statut, l.typ_projet, l.responsable,
             op.date_debut, op.date_fin, ope.get_action_libelle(op.action_2) AS action,
             op.quantite, opegerer.get_libelle(op.unite) AS unite, op.surf AS surface, op.lin AS lineaire,
             COALESCE(mo.nom, op.nom_mo) AS maitre_oeuvre,
             CASE WHEN length(op.description) > 300 THEN left(op.description, 300) || '…' ELSE op.description END AS description
      FROM opegerer.projets p
      JOIN ope.listeprojets l ON l.uuid_proj = p.uuid_proj
      LEFT JOIN opegerer.operations op ON op.ref_uuid_proj = p.uuid_proj AND op.validite IS NOT FALSE
      LEFT JOIN ann.annuaire mo ON mo.uuid_ann = op.ref_uuid_ann
      WHERE p.site = $1
        AND ($2::int IS NULL OR l.annee >= $2)
        AND ($3::int IS NULL OR l.annee <= $3)
      ORDER BY l.annee DESC, l.titre, op.date_debut NULLS LAST`, [s.uuid_site, annee_debut ?? null, annee_fin ?? null]);
    // Une entrée par projet, ses opérations imbriquées
    const projets = new Map();
    for (const { uuid_proj, annee, titre, statut, typ_projet, responsable, ...operation } of lignes) {
      if (!projets.has(uuid_proj)) projets.set(uuid_proj, { annee, titre, statut, typ_projet, responsable, operations: [] });
      // Champs vides retirés : moins de texte à lire pour un petit modèle sur CPU
      const utile = Object.fromEntries(Object.entries(operation).filter(([, v]) => v !== null && v !== ''));
      if (utile.action || utile.date_debut) projets.get(uuid_proj).operations.push(utile);
    }
    // Totaux par année et par action, calculés ici : un petit modèle se trompe en additionnant
    const totaux = new Map();
    for (const l of lignes) {
      if (!l.action) continue;
      const cle = `${l.annee}|${l.action}|${l.unite ?? ''}`;
      const t = totaux.get(cle) || { annee: l.annee, action: l.action, nb_operations: 0, quantite_totale: null, unite: l.unite };
      t.nb_operations += 1;
      if (l.quantite !== null) t.quantite_totale = (t.quantite_totale ?? 0) + Number(l.quantite);
      totaux.set(cle, t);
    }
    // Quantité non saisie dite explicitement : avec null, le modèle inventait une valeur
    const bilan = [...totaux.values()].map(t => (t.quantite_totale === null
      ? { annee: t.annee, action: t.action, nb_operations: t.nb_operations, quantite_totale: 'non saisie' }
      : { ...t, quantite_totale: Math.round(t.quantite_totale * 100) / 100 }));
    return reponse({ site: { uuid_site: s.uuid_site, code: s.code, nom: s.nom }, periode: { annee_debut, annee_fin },
      bilan_par_annee_et_action: bilan, nb_projets: projets.size, projets: [...projets.values()] });
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
             CASE WHEN $5 THEN s.uuid_site END AS uuid_site, CASE WHEN $5 THEN s.code END AS code_site,
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
      GROUP BY 1, 2, 3, 4, 5, 6
      ORDER BY 1 DESC NULLS LAST, 3, 5`, [annee_debut ?? null, annee_fin ?? null, code_site || null, action || null, par_site]);
    return resultat(lignes);
  });

  // ---------------------------------------------------------------- Indicateurs (tableaux de bord Grafana « Sites CENCA »)
  // Requêtes des panneaux Grafana, sur les mêmes vues de synthèse : mêmes chiffres que le tableau de bord.
  // « Sites gérés » = typ_site '1', validite et actuel non faux. Vues « _n-1 » = état à la fin de l'année précédente.
  const SYNTHESES = {
    departements: { actuel: 'sitcenca.synth_departements', n1: 'sitcenca."synth_departement_n-1"' },
    espaces_naturels: { actuel: 'sitcenca.synth_espacesnat', n1: 'sitcenca."synth_espacesnat_n-1"' },
    milieux_naturels: { actuel: 'sitcenca.synth_habitats', n1: 'sitcenca."synth_habitats_n-1"' },
    types_actes: { actuel: 'sitcenca.synth_actes', n1: 'sitcenca."synth_actes_n-1"' },
    assistance_technique: { actuel: 'sitcenca.synth_asstech', n1: 'sitcenca."synth_asstech_n-1"' },
    proprietaires: { actuel: 'sitcenca.synth_proprio' },
    bassins_financeurs: { actuel: 'sitcenca.synth_financeurs' },
  };
  // Ligne « null » des vues = sites gérés sans acte actuel (donc sans type d'acte ni propriétaire)
  const LIBELLE_NULL = { types_actes: ['type_acte', 'Sans acte foncier actuel'], proprietaires: ['typ_prop', 'Sans acte foncier actuel'] };

  outil(server, 'indicateurs_sites', {
    title: 'Indicateurs des sites gérés',
    description: "Chiffres clés et synthèses des sites gérés, comme le tableau de bord Grafana du CENCA (rapport d'activité). theme : "
      + "chiffres_cles (nombre de sites gérés, surface totale, parcelles MFU, nouveaux sites gérés et nouvelles assistances techniques d'une année) ; "
      + "departements (sites, surface, communes par département) ; espaces_naturels (sites gérés situés, même en partie, dans chaque zonage : Natura 2000, APB, RAMSAR, parc national, réserves…) ; "
      + "milieux_naturels (par milieu naturel principal) ; types_actes (sites et surface par type de maîtrise foncière) ; assistance_technique ; "
      + "proprietaires (par type de propriétaire) ; bassins_financeurs (par agence de l'eau) ; reserves (zonages de réserves naturelles RNR/RNN de la base) ; "
      + "protection_forte (sites en RNR, RNN, cœur de parc, APB) ; nouveaux_sites_par_an (nombre de nouveaux sites gérés par année). "
      + "annee_precedente = true : état à la fin de l'année précédente (chiffres du rapport d'activité) au lieu de l'état actuel "
      + "(chiffres_cles : nombre et surface des sites ; departements, espaces_naturels, milieux_naturels, types_actes, assistance_technique).",
    inputSchema: {
      theme: z.enum(['chiffres_cles', ...Object.keys(SYNTHESES), 'reserves', 'protection_forte', 'nouveaux_sites_par_an']),
      annee_precedente: z.boolean().default(false).describe("État à la fin de l'année précédente (rapport d'activité)"),
      annee: z.number().int().min(1970).max(2100).optional().describe("chiffres_cles : année des nouveaux sites (par défaut l'année précédente)"),
    },
  }, async ({ theme, annee_precedente, annee }) => {
    const anneeNouveaux = annee ?? new Date().getFullYear() - 1;
    if (theme === 'chiffres_cles') {
      const [ligne] = await lire(`
        SELECT
          (SELECT count(*) FROM sitcenca.sites s WHERE s.validite <> false AND s.actuel <> false AND s.typ_site = '1') AS nb_sites_geres,
          (SELECT round(sum(s.surface)::numeric, 2) FROM sitcenca.v_sites s WHERE s.typ_site = '1') AS surface_sites_geres_ha,
          (SELECT count(*) FROM sitcenca.v_export_fcen_sites WHERE terrain_militaire = 0) AS nb_sites_export_fcen_hors_militaires,
          (SELECT count(*) FROM sitcenca.listparcelles) AS nb_parcelles_mfu,
          $1::int AS annee_nouveaux_sites,
          (SELECT count(*) FROM sitcenca.v_sites WHERE prem_ctr = $1 AND validite IS TRUE AND actuel IS TRUE AND typ_site = '1') AS nb_nouveaux_sites_geres,
          (SELECT round(sum(surface)::numeric, 2) FROM sitcenca.v_sites WHERE prem_ctr = $1 AND validite IS TRUE AND actuel IS TRUE AND typ_site = '1') AS surface_nouveaux_sites_geres_ha,
          (SELECT count(*) FROM sitcenca.sites s WHERE s.validite IS TRUE AND s.actuel IS TRUE AND s.typ_site = '2' AND s.prem_ctr = $1) AS nb_nouvelles_assistances_techniques`,
        [anneeNouveaux]);
      if (annee_precedente) {
        const [total] = await lire(`SELECT nb_sites, round(surface::numeric, 2) AS surface FROM sitcenca."synth_departement_n-1" WHERE dep = 'TOTAL'`);
        return reponse({ theme, periode: "fin de l'année précédente (nombre et surface des sites) ; parcelles MFU : état actuel", ...ligne,
          nb_sites_geres: total?.nb_sites, surface_sites_geres_ha: total?.surface });
      }
      return reponse({ theme, periode: 'actuel', ...ligne });
    }
    if (theme === 'protection_forte') {
      const lignes = await lire(`
        SELECT count(*) FILTER (WHERE site_rnr::int = 1) AS sites_rnr, count(*) FILTER (WHERE site_rnn::int = 1) AS sites_rnn,
               count(*) FILTER (WHERE coeur_parc_de_forets::int = 1) AS sites_coeur_parc_forets, count(*) FILTER (WHERE apb::int = 1) AS sites_apb,
               count(*) FILTER (WHERE greatest(site_rnr::int, site_rnn::int, coeur_parc_de_forets::int, apb::int) = 1) AS sites_protection_forte,
               round(sum(surface) FILTER (WHERE greatest(site_rnr::int, site_rnn::int, coeur_parc_de_forets::int, apb::int) = 1)::numeric, 2) AS surface_protection_forte_ha
        FROM sitcenca.m_synth_protec_sites`);
      return resultat(lignes, { theme });
    }
    if (theme === 'reserves') {
      // Pas la vue synth_reserves : OR sans parenthèses et filtre typ_site '1', alors que les zonages
      // de réserves sont des « Autres sites » (typ_site '4') → elle ne comptait que les RNN
      const lignes = await lire(`
        SELECT e.typ_espace, count(*) AS nb_reserves, round(sum(e.surface)::numeric, 2) AS surface_ha,
               string_agg(e.nom, ' ; ' ORDER BY e.nom) AS reserves
        FROM sitcenca.sites s
        JOIN esp.espaces e ON e.uuid_espace = s.espace
        WHERE s.actuel <> false AND s.validite <> false AND e.typ_espace IN ('RNR', 'RNN')
        GROUP BY e.typ_espace
        ORDER BY e.typ_espace`);
      return resultat(lignes, { theme, note: "Zonages réglementaires des réserves (sites de type « Autre site »). Pour les sites gérés situés dans une réserve : theme espaces_naturels ou protection_forte." });
    }
    if (theme === 'nouveaux_sites_par_an') {
      // Même définition que chiffres_cles (sitcenca.sites) ; irenee.cenca_sites, utilisé par Grafana, n'est plus à jour
      const lignes = await lire(`
        SELECT prem_ctr AS annee, count(*) AS nouveaux_sites
        FROM sitcenca.sites
        WHERE validite IS TRUE AND actuel IS TRUE AND typ_site = '1'
        GROUP BY prem_ctr
        ORDER BY prem_ctr NULLS LAST`);
      return resultat(lignes, { theme });
    }
    const vues = SYNTHESES[theme];
    const vue = annee_precedente && vues.n1 ? vues.n1 : vues.actuel;
    const lignes = await lire(`SELECT * FROM ${vue}`);
    const [colonne, libelle] = LIBELLE_NULL[theme] || [];
    if (colonne) for (const l of lignes) l[colonne] ??= libelle;
    const periode = vue === vues.n1 ? "fin de l'année précédente" : annee_precedente ? "actuel (pas d'état de fin d'année pour ce thème)" : 'actuel';
    return resultat(lignes, { theme, periode });
  });

  outil(server, 'indicateurs_activite', {
    title: "Indicateurs d'activité",
    description: "Indicateurs d'activité du tableau de bord Grafana. theme : animations (sorties nature de l'année précédente : nombre et personnes sensibilisées par type, grand public, scolaires, élus) ; "
      + "plans_de_gestion (plans de gestion de l'année précédente) ; animation_fonciere (parcelles questionnées lors de l'animation foncière, par année et par département ou par demandeur).",
    inputSchema: {
      theme: z.enum(['animations', 'plans_de_gestion', 'animation_fonciere']),
      regroupement: z.enum(['departement', 'demandeur']).default('departement').describe('animation_fonciere : regroupement en plus de l\'année'),
    },
  }, async ({ theme, regroupement }) => {
    if (theme === 'animations') {
      const lignes = await lire(`
        SELECT coalesce(action_n3, 'Total') AS type_animation, count(*) AS nb_animations, sum(nb_personnes) AS nb_personnes
        FROM opeautres."synth_anim_brute_n-1"
        GROUP BY ROLLUP (action_n3)
        ORDER BY action_n3 IS NULL, count(*) DESC`);
      return resultat(lignes, { theme, periode: "année précédente" });
    }
    if (theme === 'plans_de_gestion') {
      const lignes = await lire(`
        SELECT nom, statut, responsable, localisation, typ_projet, typ_intervention, action_n2, action_n3, cibles, detail
        FROM opeautres."synth_pdg_brute_n-1"`);
      return resultat(lignes, { theme, periode: "année précédente" });
    }
    const colonne = regroupement === 'demandeur' ? 'hfo_demandeur' : 'hfo_dep';
    const lignes = await lire(`
      SELECT extract(year FROM hfo_date_extraction)::int AS annee, ${colonne} AS ${regroupement}, count(*) AS nb_parcelles
      FROM irenee.histo_foncier
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2`);
    return resultat(lignes, { theme });
  });

  outil(server, 'controle_donnees_sites', {
    title: 'Contrôle des données des sites',
    description: "Sites gérés dont les données sont incomplètes (contrôles du tableau de bord Grafana). anomalie : sans_geometrie (aucun contour valide) ; "
      + "sans_acte (aucun acte, actes tous terminés, acte en cours mais marqué non actuel, ou acte actuel sans parcelle ; colonne probleme) ; donnees_manquantes (surface absente ou nulle, milieu naturel principal, commune, année de premier contrat ou type d'espace absent ; colonne manque).",
    inputSchema: {
      anomalie: z.enum(['sans_geometrie', 'sans_acte', 'donnees_manquantes']),
    },
  }, async ({ anomalie }) => {
    const requetes = {
      sans_geometrie: `
        SELECT s.uuid_site, s.code, e.nom, s.responsable, s.prem_ctr
        FROM sitcenca.sites s
        LEFT JOIN esp.espaces e ON e.uuid_espace = s.espace
        WHERE s.actuel <> false AND s.validite <> false AND s.typ_site = '1'
          AND NOT EXISTS (SELECT 1 FROM esp.geometries g WHERE g.espace = s.espace AND g.validite IS NOT FALSE)
        ORDER BY s.code`,
      sans_acte: `
        SELECT s.uuid_site, s.code, e.nom, s.responsable, s.prem_ctr,
               CASE WHEN a.nb_actes > 0 THEN 'acte actuel sans parcelle'
                    WHEN h.en_cours > 0 THEN 'acte en cours d''après ses dates mais marqué non actuel'
                    WHEN h.tous = 0 THEN 'aucun acte'
                    ELSE 'actes tous terminés' END AS probleme
        FROM sitcenca.sites s
        LEFT JOIN esp.espaces e ON e.uuid_espace = s.espace
        CROSS JOIN LATERAL (
          SELECT count(*) AS nb_actes,
                 count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM sitcenca.parcelles_mfu p WHERE p.acte_mfu = m.uuid_acte)) AS sans_parcelle
          FROM sitcenca.actes_mfu m
          WHERE m.site = s.uuid_site AND m.actuel IS TRUE AND m.validite IS NOT FALSE
        ) a
        CROSS JOIN LATERAL (
          SELECT count(*) AS tous, count(*) FILTER (WHERE m.validite IS NOT FALSE AND (m.fin IS NULL OR m.fin >= current_date)) AS en_cours
          FROM sitcenca.actes_mfu m
          WHERE m.site = s.uuid_site
        ) h
        WHERE s.actuel <> false AND s.validite <> false AND s.typ_site = '1' AND (a.nb_actes = 0 OR a.sans_parcelle > 0)
        ORDER BY probleme, s.prem_ctr, s.code`,
      donnees_manquantes: `
        SELECT uuid_site, code_site AS code, nom_site AS nom,
               array_to_string(array_remove(ARRAY[
                 CASE WHEN coalesce(surface, 0) = 0 THEN 'surface' END,
                 CASE WHEN milieu_naturel_principal IS NULL THEN 'milieu naturel principal' END,
                 CASE WHEN commune IS NULL THEN 'commune (aucune parcelle d''acte)' END,
                 CASE WHEN prem_ctr IS NULL THEN 'année de premier contrat' END,
                 CASE WHEN "Type espace" IS NULL THEN 'type d''espace' END], NULL), ', ') AS manque,
               "Type espace" AS type_espace, surface, prem_ctr
        FROM sitcenca.v_sites
        WHERE typ_site = '1' AND (coalesce(surface, 0) = 0 OR milieu_naturel_principal IS NULL OR commune IS NULL OR prem_ctr IS NULL OR "Type espace" IS NULL)
        ORDER BY code_site`,
    };
    return resultat(await lire(requetes[anomalie]), { anomalie });
  });

  // ---------------------------------------------------------------- Suivi (requêtes de ressources/bdd/exemples_sql.json)
  outil(server, 'perimetres_modifies', {
    title: 'Périmètres de sites modifiés',
    description: "Sites gérés dont le contour (géométrie) a été modifié une année donnée, hors sites créés cette année-là (vue sitcenca.v_export_fcen_sites, celle de l'export annuel à la FCEN). "
      + "Par défaut l'année précédente (rapport d'activité). Renvoie le code, le nom, la surface actuelle, la date de création du site et les dates de modification de la fiche et du contour. "
      + "Ex. : « Quels sites ont changé de périmètre en 2025 ? ». Pour les nouveaux sites d'une année, utiliser rechercher_sites (annee_premier_contrat).",
    inputSchema: {
      annee: z.number().int().min(2000).max(2100).optional().describe("Année de modification du contour (défaut : l'année précédente)"),
    },
  }, async ({ annee }) => {
    const an = annee ?? new Date().getFullYear() - 1;
    const lignes = await lire(`
      SELECT id_site_cen AS code, nom_site AS nom, round((ST_Area(geom) / 10000)::numeric, 2) AS surface_ha,
             date_crea_site::text AS creation_site, date_maj_site::text AS modification_fiche, date_maj_s::text AS modification_contour
      FROM sitcenca.v_export_fcen_sites
      WHERE EXTRACT(year FROM date_maj_s) = $1
        AND EXTRACT(year FROM date_maj_s) IS DISTINCT FROM EXTRACT(year FROM date_crea_site)
      ORDER BY date_maj_s, id_site_cen`, [an]);
    return resultat(lignes, { annee: an });
  });

  outil(server, 'mesures_compensatoires', {
    title: 'Mesures compensatoires',
    description: "Projets de mesures compensatoires suivis par le CENCA (vue mescomp.v_mescomp) : nom du projet (éolien, carrière…), société, durée, année de début, objectifs, "
      + "et les sites concernés avec le type d'intervention (actions ponctuelles, contrat lié à). Filtres : texte (nom du projet ou de la société), site. "
      + "Ex. : « Quelles mesures compensatoires suit-on ? », « Mesures compensatoires liées aux carrières ».",
    inputSchema: {
      texte: z.string().min(2).optional().describe('Partie du nom du projet ou de la société (ex. éolien, carrière, EQIOM)'),
      site: z.string().min(2).optional().describe('Code, uuid_site ou nom du site'),
    },
  }, async ({ texte, site }) => {
    const s = site ? await trouverSiteParNom(site) : null;
    const lignes = await lire(`
      SELECT m.uuid_projet, m.nom AS projet, nullif(m.societe, '') AS societe, nullif(m.duree, '') AS duree, m.debut,
             nullif(m.objectifs, '') AS objectifs, nullif(m.document, '') AS document,
             m.libelle AS type_intervention, s.code, e.nom AS site, s.uuid_site
      FROM mescomp.v_mescomp m
      LEFT JOIN sitcenca.sites s ON s.uuid_site = m.site
      LEFT JOIN esp.espaces e ON e.uuid_espace = s.espace
      WHERE m.validite IS DISTINCT FROM 'false'
        AND ($1::text IS NULL OR ${contientTexte('m.nom', '$1')} OR ${contientTexte('m.societe', '$1')})
        AND ($2::text IS NULL OR m.uuid_projet IN (SELECT projet FROM mescomp.sites_mc WHERE site = $2))
      ORDER BY m.nom, s.code`, [texte || null, s?.uuid_site || null]);
    // Une entrée par projet, ses sites imbriqués
    const projets = new Map();
    for (const { uuid_projet, code, site: nom, uuid_site, type_intervention, ...projet } of lignes) {
      if (!projets.has(uuid_projet)) {
        projets.set(uuid_projet, { ...Object.fromEntries(Object.entries(projet).filter(([, v]) => v !== null)), sites: [] });
      }
      if (uuid_site) projets.get(uuid_projet).sites.push({ code, nom, uuid_site, type_intervention });
    }
    return resultat([...projets.values()], { nb_projets: projets.size });
  });

  outil(server, 'objectifs_projets', {
    title: 'Objectifs des projets de gestion',
    description: "Objectifs des projets de gestion d'un site (ou d'un projet) : type d'objectif (unité de gestion, accueil du public), niveau d'enjeu (espèces, communauté, habitat), "
      + "enjeux écologiques visés, objectif opérationnel (conserver, restaurer, entretenir…), résultats attendus, surfaces totale et prévue. "
      + "site = code, uuid_site ou nom ; ou uuid_proj (donné par rechercher_projets ou travaux_site). Période : annee_debut / annee_fin. "
      + "Ex. : « Quels sont les objectifs de gestion du Marais de Villechétif ? ». Pour les travaux réalisés, utiliser travaux_site.",
    inputSchema: {
      site: z.string().min(2).optional().describe('Code (ex. 10035), uuid_site ou nom du site'),
      uuid_proj: z.string().min(8).optional().describe("Identifiant d'un projet précis"),
      annee_debut: z.number().int().optional().describe('Première année de projet incluse'),
      annee_fin: z.number().int().optional().describe('Dernière année de projet incluse'),
    },
  }, async ({ site, uuid_proj, annee_debut, annee_fin }) => {
    if (!site && !uuid_proj) throw new Error('Indiquer un site (code, uuid ou nom) ou un uuid_proj.');
    const s = site ? await trouverSiteParNom(site) : null;
    const lignes = await lire(`
      SELECT p.uuid_proj, l.annee, l.titre, l.statut,
             CASE WHEN o.typ_objectif <> '' THEN t.libelle END AS type_objectif, en.libelle AS niveau_enjeu,
             CASE WHEN length(o.enjeux_eco) > 300 THEN left(o.enjeux_eco, 300) || '…' ELSE nullif(o.enjeux_eco, '') END AS enjeux,
             op.libelle AS objectif_operationnel,
             CASE WHEN length(o.attentes) > 300 THEN left(o.attentes, 300) || '…' ELSE nullif(o.attentes, '') END AS attentes,
             nullif(o.surf_totale, '') AS surface_totale, nullif(o.surf_prevue, '') AS surface_prevue,
             nullif(o.unite_gestion, '') AS unite_gestion, nullif(o.pression_maitrise, '') AS pression_maitrise
      FROM opegerer.projets p
      JOIN ope.listeprojets l ON l.uuid_proj = p.uuid_proj
      JOIN opegerer.objectifs o ON o.projet = p.uuid_proj AND o.validite IS NOT FALSE
      LEFT JOIN opegerer.typ_objectifs t ON t.cd_type = o.typ_objectif
      LEFT JOIN opegerer.typ_enjeux en ON en.cd_type = o.nv_enjeux
      LEFT JOIN opegerer.typ_objectifope op ON op.cd_type = o.obj_ope
      WHERE ($1::text IS NULL OR p.site = $1)
        AND ($2::text IS NULL OR upper(p.uuid_proj) = upper($2))
        AND ($3::int IS NULL OR l.annee >= $3)
        AND ($4::int IS NULL OR l.annee <= $4)
      ORDER BY l.annee DESC, l.titre`, [s?.uuid_site || null, uuid_proj || null, annee_debut ?? null, annee_fin ?? null]);
    // Une entrée par projet, ses objectifs imbriqués (champs vides retirés)
    const projets = new Map();
    for (const { uuid_proj: id, annee, titre, statut, ...objectif } of lignes) {
      if (!projets.has(id)) projets.set(id, { uuid_proj: id, annee, titre, statut, objectifs: [] });
      projets.get(id).objectifs.push(Object.fromEntries(Object.entries(objectif).filter(([, v]) => v !== null)));
    }
    return reponse({ ...(s && { site: { uuid_site: s.uuid_site, code: s.code, nom: s.nom } }), nb_projets: projets.size, projets: [...projets.values()] });
  });
}

module.exports = { enregistrerRequetesMetier, outil, trouverSite, trouverSiteParNom, numeroDepartement };
