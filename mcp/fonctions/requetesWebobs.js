"use strict";

/**
 * Outils sur les observations naturalistes WebObs (base natobs, autre serveur PostgreSQL),
 * croisées avec les emprises des sites du CENCA (base des sites).
 *
 * Les deux bases sont sur deux serveurs : pas de jointure SQL entre elles. Les géométries des sites
 * sont lues dans la base des sites (Lambert 93), envoyées en EWKB hexadécimal à natobs et
 * reprojetées en WGS84 (SRID des observations) pour profiter de l'index spatial de export_obs.webobs.
 *
 * ATTENTION, export_obs.webobs a des colonnes décalées : à partir de la colonne « i », chaque colonne
 * contient la valeur de la colonne SUIVANTE de l'export WebObs (une colonne manque dans l'en-tête de
 * l'import). Vérifié sur des espèces aux statuts connus (Mésange charbonnière protégée → « nmo4 »,
 * Sabot de Vénus → « np1 », Grand Murin → « ni3 », Tourterelle des bois LR Europe VU → « z4 »).
 * Les expressions ci-dessous lisent donc la colonne précédant le nom du statut.
 */

const { z } = require('zod');
const { LECTURE_SEULE, reponse, erreur, journaliser, lire, lireWebobs, resultat, texteNormalise } = require('./utilitaires');
const { trouverSiteParNom, numeroDepartement } = require('./requetesMetier');

const DATE = `to_date(w.date, 'DD/MM/YYYY')`;
const ESPECE = `coalesce(nullif(trim(w."nom français"), ''), w.nom)`;

const GROUPES_FAUNE = ['Oiseaux', 'Reptiles', 'Insectes', 'Mollusques', 'Poissons', 'Amphibiens', 'Mammifères', 'Autres invertébrés'];
const GROUPES_FLORE = ['Flore', 'Champignons et Lichens', 'Mousses', 'Algues'];
const liste = valeurs => valeurs.map(v => `'${v}'`).join(', ');
const FAUNE = `w.observatoire IN (${liste(GROUPES_FAUNE)})`;
const FLORE = `w.observatoire IN (${liste(GROUPES_FLORE)})`;

// Statuts des espèces (colonnes décalées d'un cran, cf. en-tête)
const MENACE = `~ '(^|-)(CR|EN|VU)(-|$)'`;
const STATUTS = {
  protection_nationale: {
    libelle: 'protection nationale',
    sql: `'Oui' IN (w.lre3, w.nar2, w.nar3, w.nar4, w.nar5, w.nar6, w.ni2, w.ni3, w.nm2, w.nmo2, w.nmo3, w.nmo4, w.no3, w.no4, w.np1, w.nv1)`,
  },
  protection_regionale: {
    libelle: 'protection régionale ou départementale',
    sql: `'Oui' IN (w.nv2, w.dv08, w.dv10, w.dv51, w.dv54, w.dv55, w.dv57, w.rv21, w.rv41)`,
  },
  directive_habitats: { libelle: 'directive Habitats (annexe II ou IV)', sql: `(w.cdh2 = 'Oui' OR w.cdh4 = 'Oui')` },
  directive_oiseaux: { libelle: 'directive Oiseaux (annexe I)', sql: `w.cdo1 = 'Oui'` },
  determinante_znieff: { libelle: 'déterminante ZNIEFF', sql: `'Oui' IN (w.rv42, w.z1, w.z2, w.z3)` },
  menacee_france: { libelle: 'menacée en France (liste rouge CR/EN/VU)', sql: `w.lre ${MENACE}` },
  menacee_region: { libelle: 'menacée en région (liste rouge CR/EN/VU)', sql: `w.lrf ${MENACE}` },
};
STATUTS.protegee = { libelle: 'protégée (nationale, régionale ou départementale)', sql: `(${STATUTS.protection_nationale.sql} OR ${STATUTS.protection_regionale.sql})` };
STATUTS.menacee = { libelle: 'menacée (liste rouge France ou région)', sql: `(${STATUTS.menacee_france.sql} OR ${STATUTS.menacee_region.sql})` };
STATUTS.patrimoniale = {
  libelle: 'patrimoniale (protégée, directive européenne, menacée ou déterminante ZNIEFF)',
  sql: `(${STATUTS.protegee.sql} OR ${STATUTS.directive_habitats.sql} OR ${STATUTS.directive_oiseaux.sql} OR ${STATUTS.menacee.sql} OR ${STATUTS.determinante_znieff.sql})`,
};
const CLES_STATUTS = Object.keys(STATUTS);
const STATUTS_AFFICHES = ['protection_nationale', 'protection_regionale', 'directive_habitats', 'directive_oiseaux', 'determinante_znieff'];

/** Statuts d'une espèce (agrégat) et ses listes rouges */
const COLONNES_STATUTS = `
  concat_ws(', ', ${STATUTS_AFFICHES.map(cle => `CASE WHEN bool_or(${STATUTS[cle].sql}) THEN '${STATUTS[cle].libelle}' END`).join(', ')}) AS statuts,
  nullif(max(w.lre), '') AS liste_rouge_france,
  nullif(max(w.lrf), '') AS liste_rouge_region,
  nullif(max(w.a2), '') AS rarete_regionale`;

// Données sensibles : jamais de nom d'espèce à une échelle plus fine que celle autorisée.
// Colonnes décalées : « type validation » = sensibilité, « détermination » = diffusable.
const SENSIBLE_SITE = `(w."type validation" <> '' OR w.floutage <> 'Aucun' OR w."détermination" = 'Non')`;
const SENSIBLE_COMMUNE = `(w."type validation" IN ('Maille 10', 'Département') OR w.floutage = 'Département' OR w."détermination" = 'Non')`;
const NOM_MASQUE = 'Espèce sensible (nom masqué)';

/**
 * Comparaison sans accents, casse ni ponctuation (pas d'extension unaccent sur natobs) : natobs écrit
 * « Colombey-les-Deux-Églises », la base des sites « Colombey les Deux Églises ».
 */
const sansAccent = expr => texteNormalise(expr, e =>
  // Majuscules accentuées traduites aussi : lower() de natobs (locale C) ne les convertit pas
  `replace(replace(translate(lower(${e}), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝŒÆ', 'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuyœæ'), 'œ', 'oe'), 'æ', 'ae')`);

const schemaAnnee = z.number().int().min(1900).max(2100);
const filtresCommuns = {
  annee_debut: schemaAnnee.optional().describe("Première année d'observation incluse"),
  annee_fin: schemaAnnee.optional().describe("Dernière année d'observation incluse"),
  groupe: z.enum(['faune', 'flore', ...GROUPES_FAUNE, ...GROUPES_FLORE]).optional()
    .describe("Groupe taxonomique (observatoire WebObs), ou 'faune' / 'flore' (flore = plantes, mousses, algues, champignons et lichens)"),
  espece: z.string().min(2).optional().describe('Nom français ou scientifique, même partiel (ex. « sonneur », « Bombina »)'),
  statut: z.enum(CLES_STATUTS).optional()
    .describe("Ne garder que les espèces ayant ce statut : protegee, protection_nationale, protection_regionale, directive_habitats, directive_oiseaux, determinante_znieff, menacee, menacee_france, menacee_region, patrimoniale"),
};

/**
 * Conditions SQL des filtres communs ; ajoute les valeurs à `params` ($1, $2…).
 */
function conditions(args, params) {
  const ajouter = valeur => { params.push(valeur); return `$${params.length}`; };
  const c = [];
  if (args.annee_debut) c.push(`${DATE} >= make_date(${ajouter(args.annee_debut)}::int, 1, 1)`);
  if (args.annee_fin) c.push(`${DATE} < make_date(${ajouter(args.annee_fin)}::int + 1, 1, 1)`);
  if (args.groupe === 'faune') c.push(FAUNE);
  else if (args.groupe === 'flore') c.push(FLORE);
  else if (args.groupe) c.push(`w.observatoire = ${ajouter(args.groupe)}`);
  if (args.espece) {
    const p = ajouter(args.espece.trim());
    c.push(`(${sansAccent(ESPECE)} LIKE '%' || ${sansAccent(p)} || '%' OR ${sansAccent('w.nom')} LIKE '%' || ${sansAccent(p)} || '%')`);
  }
  if (args.statut) c.push(STATUTS[args.statut].sql);
  if (args.departement) {
    const dep = numeroDepartement(args.departement);
    const p = ajouter(dep);
    c.push(/^\d{2}$/.test(dep) ? `w."code dep" = ${p}` : `${sansAccent('w."département"')} = ${sansAccent(p)}`);
  }
  if (args.commune) {
    const p = ajouter(args.commune.trim());
    c.push(`(w."code insee" = ${p} OR ${sansAccent('w.commune')} = ${sansAccent(p)})`);
  }
  return c;
}
const where = c => (c.length ? `WHERE ${c.join(' AND ')}` : '');

/** Période couverte par l'export WebObs (mise en cache : l'export change rarement) */
let periode;
function periodeDonnees() {
  periode ||= lireWebobs(`SELECT min(${DATE})::text AS debut, max(${DATE})::text AS fin FROM export_obs.webobs w`)
    .then(([p]) => `observations WebObs du ${p.debut} au ${p.fin} (export ; les saisies plus récentes n'y sont pas)`)
    .catch(e => { periode = null; throw e; });
  return periode;
}

/** Remplace les espèces sensibles par une seule ligne « nom masqué » */
function masquerEspeces(lignes) {
  const visibles = lignes.filter(l => !l.sensible);
  const masquees = lignes.filter(l => l.sensible);
  for (const l of visibles) delete l.sensible;
  if (masquees.length) {
    visibles.push({
      espece: NOM_MASQUE, nb_especes: masquees.length,
      nb_observations: masquees.reduce((total, l) => total + Number(l.nb_observations), 0),
    });
  }
  return visibles;
}

/** Emprise d'un site (union de ses géométries valides, élargie de `tampon` mètres) en EWKB hexadécimal */
async function empriseSite(site, tampon = 0) {
  const s = await trouverSiteParNom(site);
  const [g] = await lire(`
    SELECT ST_AsHEXEWKB(ST_Buffer(ST_Union(g.geom), $2)) AS ewkb, round((ST_Area(ST_Union(g.geom)) / 10000)::numeric, 2) AS surface_ha
    FROM esp.geometries g
    WHERE g.espace = $1 AND g.validite IS NOT FALSE`, [s.espace, tampon]);
  if (!g?.ewkb) throw new Error(`Le site ${s.code || s.uuid_site} (${s.nom}) n'a pas de géométrie : impossible de croiser avec les observations.`);
  return { site: { uuid_site: s.uuid_site, code: s.code, nom: s.nom, surface_ha: g.surface_ha }, ewkb: g.ewkb };
}

// Observations localisées à la commune seulement (centroïde) : jamais rattachées à un site
const LOCALISEE = `w."précision" <> 'Commune'`;
const DANS_EMPRISE = p => `ST_Intersects(w.geom, ST_Transform(ST_GeomFromEWKB(decode(${p}, 'hex')), 4326))`;

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

function enregistrerRequetesWebobs(server) {

  outil(server, 'webobs_statistiques', {
    title: 'Statistiques des observations naturalistes',
    description: "Statistiques des observations naturalistes WebObs (faune et flore, Champagne-Ardenne et alentours, depuis 2000) : nombre d'observations, d'espèces et d'observateurs, "
      + "regroupés par année, groupe taxonomique (oiseaux, insectes, flore…), faune/flore, département ou commune. Filtres : années, groupe, espèce, statut, département, commune. "
      + "Ex. : observations par an, observations de l'année dernière par groupe, communes les plus prospectées pour les amphibiens.",
    inputSchema: {
      regroupement: z.enum(['annee', 'groupe', 'faune_flore', 'departement', 'commune']).default('annee'),
      ...filtresCommuns,
      departement: z.string().optional().describe('Numéro ou nom du département (ex. 51, Marne, Meuse)'),
      commune: z.string().optional().describe('Nom ou code INSEE de la commune'),
    },
  }, async (args) => {
    const params = [];
    const cle = {
      annee: `extract(year FROM ${DATE})::int`,
      groupe: 'w.observatoire',
      faune_flore: `CASE WHEN ${FAUNE} THEN 'Faune' WHEN ${FLORE} THEN 'Flore' ELSE 'Autre' END`,
      departement: `w."code dep" || ' ' || w."département"`,
      commune: `w.commune || ' (' || w."code insee" || ')'`,
    }[args.regroupement];
    const tri = args.regroupement === 'annee' ? '1 DESC' : '2 DESC';
    const lignes = await lireWebobs(`
      SELECT ${cle} AS ${args.regroupement}, count(*) AS nb_observations, count(DISTINCT ${ESPECE}) AS nb_especes,
             count(DISTINCT w.observateur) AS nb_observateurs
      FROM export_obs.webobs w
      ${where(conditions(args, params))}
      GROUP BY 1
      ORDER BY ${tri}`, params);
    return resultat(lignes, { source: await periodeDonnees() });
  });

  outil(server, 'webobs_especes', {
    title: 'Espèces observées',
    description: "Espèces observées dans WebObs avec leur nombre d'observations, première et dernière année, statuts (protection, directives européennes, déterminante ZNIEFF), listes rouges France et région, rareté régionale. "
      + "Filtres : département, commune, groupe, espèce, statut, années. tri : plus_observees, moins_observees (espèces rares dans les données), recentes. "
      + "Ex. : reptiles les plus observés dans la Marne, espèces protégées observées à Givet, oiseaux menacés vus en 2025. "
      + "Dans une commune, les espèces sensibles sont regroupées sous un nom masqué. Pour un site du CENCA, utiliser webobs_site.",
    inputSchema: {
      ...filtresCommuns,
      departement: z.string().optional().describe('Numéro ou nom du département (ex. 51, Marne, Meuse)'),
      commune: z.string().optional().describe('Nom ou code INSEE de la commune'),
      tri: z.enum(['plus_observees', 'moins_observees', 'recentes']).default('plus_observees'),
      limite: z.number().int().min(1).max(500).default(50),
    },
  }, async (args) => {
    const params = [];
    const filtre = where(conditions(args, params));
    const sensible = args.commune ? SENSIBLE_COMMUNE : 'false';
    const tri = { plus_observees: 'nb_observations DESC', moins_observees: 'nb_observations ASC', recentes: 'derniere_observation DESC' }[args.tri];
    params.push(args.limite);
    const [lignes, [total]] = await Promise.all([
      lireWebobs(`
        SELECT ${ESPECE} AS espece, max(w.nom) AS nom_scientifique, max(w.observatoire) AS groupe,
               count(*) AS nb_observations, count(DISTINCT w."code insee") AS nb_communes,
               min(extract(year FROM ${DATE}))::int AS premiere_annee, max(${DATE})::text AS derniere_observation,
               ${COLONNES_STATUTS},
               bool_or(${sensible}) AS sensible
        FROM export_obs.webobs w
        ${filtre}
        GROUP BY ${ESPECE}
        ORDER BY ${tri}, espece
        LIMIT $${params.length}`, params),
      lireWebobs(`SELECT count(*) AS nb_observations, count(DISTINCT ${ESPECE}) AS nb_especes FROM export_obs.webobs w ${filtre}`, params.slice(0, -1)),
    ]);
    return resultat(masquerEspeces(lignes), {
      source: await periodeDonnees(),
      total_observations: total.nb_observations, total_especes: total.nb_especes,
      note: Number(total.nb_especes) > lignes.length ? `${lignes.length} espèces affichées sur ${total.nb_especes}` : undefined,
    });
  });

  outil(server, 'webobs_site', {
    title: "Observations naturalistes d'un site",
    description: "Observations naturalistes WebObs situées dans l'emprise d'un site du CENCA (géométrie du site, élargie de tampon_m mètres si demandé) : "
      + "synthèse (observations, espèces, observateurs, première et dernière date, répartition par groupe) et liste des espèces avec statuts et listes rouges. "
      + "Filtres : groupe, statut, espèce, années. Ex. : « Quelles espèces protégées ont été vues sur le site 10035 ? », « Inventaire des oiseaux du Marais de Reuves ». "
      + "Les observations localisées seulement à la commune sont exclues ; les espèces sensibles sont regroupées sous un nom masqué.",
    inputSchema: {
      site: z.string().min(1).describe('Code du site (ex. 10035, 51BOIS01), uuid_site ou nom du site (même partiel, sans accents)'),
      tampon_m: z.number().min(0).max(2000).default(0).describe('Élargir l\'emprise du site de N mètres (0 = emprise exacte)'),
      ...filtresCommuns,
      limite: z.number().int().min(1).max(500).default(100).describe("Nombre maximum d'espèces listées"),
    },
  }, async (args) => {
    const { site, ewkb } = await empriseSite(args.site, args.tampon_m);
    const params = [ewkb];
    const c = [LOCALISEE, DANS_EMPRISE('$1'), ...conditions(args, params)];
    const filtre = where(c);
    const [synthese, groupes, especes] = await Promise.all([
      lireWebobs(`
        SELECT count(*) AS nb_observations, count(DISTINCT ${ESPECE}) AS nb_especes, count(DISTINCT w.observateur) AS nb_observateurs,
               min(${DATE})::text AS premiere_observation, max(${DATE})::text AS derniere_observation
        FROM export_obs.webobs w ${filtre}`, params),
      lireWebobs(`
        SELECT w.observatoire AS groupe, count(*) AS nb_observations, count(DISTINCT ${ESPECE}) AS nb_especes
        FROM export_obs.webobs w ${filtre}
        GROUP BY 1 ORDER BY 2 DESC`, params),
      lireWebobs(`
        SELECT ${ESPECE} AS espece, max(w.nom) AS nom_scientifique, max(w.observatoire) AS groupe, count(*) AS nb_observations,
               max(${DATE})::text AS derniere_observation, ${COLONNES_STATUTS}, bool_or(${SENSIBLE_SITE}) AS sensible
        FROM export_obs.webobs w ${filtre}
        GROUP BY ${ESPECE}
        ORDER BY nb_observations DESC, espece
        LIMIT ${args.limite}`, params),
    ]);
    return reponse({
      source: await periodeDonnees(),
      site, tampon_m: args.tampon_m,
      synthese: { ...synthese[0], par_groupe: groupes },
      nb_especes_listees: especes.length,
      especes: masquerEspeces(especes),
    });
  });

  outil(server, 'webobs_sites_cenca', {
    title: 'Observations naturalistes par site du CENCA',
    description: "Croise les observations WebObs avec les emprises de tous les sites gérés par le CENCA : par site, nombre d'observations, d'espèces, d'espèces protégées, menacées et patrimoniales, dernière observation. "
      + "Filtres : espèce (« sur quels sites trouve-t-on le Sonneur à ventre jaune ? »), groupe, statut, années, département des sites. "
      + "tri : especes (sites les plus riches), observations, especes_patrimoniales, derniere_observation, ou moins_observes (sites les moins prospectés, sites sans aucune observation compris). "
      + "Pour le détail d'un site, utiliser webobs_site.",
    inputSchema: {
      ...filtresCommuns,
      departement: z.string().optional().describe('Département des sites du CENCA (ex. 51, Marne)'),
      tri: z.enum(['especes', 'observations', 'especes_patrimoniales', 'derniere_observation', 'moins_observes']).default('especes'),
      limite: z.number().int().min(1).max(400).default(30),
    },
  }, async (args) => {
    const dep = numeroDepartement(args.departement);
    const sites = await lire(`
      SELECT s.uuid_site, s.code, e.nom, ST_AsHEXEWKB(ST_Union(g.geom)) AS ewkb
      FROM sitcenca.sites s
      JOIN esp.espaces e ON e.uuid_espace = s.espace
      JOIN esp.geometries g ON g.espace = s.espace AND g.validite IS NOT FALSE
      WHERE s.typ_site = '1' AND s.actuel IS NOT FALSE AND s.validite IS NOT FALSE
        AND ($1::text IS NULL OR left(s.code, 2) = $1)
      GROUP BY s.uuid_site, s.code, e.nom`, [dep || null]);
    if (!sites.length) throw new Error('Aucun site géré avec géométrie pour ces critères.');

    const params = [sites.map(s => s.uuid_site), sites.map(s => s.ewkb)];
    // Recherche d'une espèce : ses observations sensibles ne localisent jamais un site
    // Le département filtre les sites (ci-dessus), pas les observations
    const c = [LOCALISEE, ...conditions({ ...args, departement: undefined }, params), ...(args.espece ? [`NOT ${SENSIBLE_SITE}`] : [])];
    const lignes = await lireWebobs(`
      WITH sites AS (
        SELECT uuid_site, ST_Transform(ST_GeomFromEWKB(decode(ewkb, 'hex')), 4326) AS geom
        FROM unnest($1::text[], $2::text[]) AS t(uuid_site, ewkb)
      )
      SELECT s.uuid_site, count(w.id) AS nb_observations, count(DISTINCT ${ESPECE}) AS nb_especes,
             count(DISTINCT ${ESPECE}) FILTER (WHERE ${STATUTS.protegee.sql}) AS nb_especes_protegees,
             count(DISTINCT ${ESPECE}) FILTER (WHERE ${STATUTS.menacee.sql}) AS nb_especes_menacees,
             count(DISTINCT ${ESPECE}) FILTER (WHERE ${STATUTS.patrimoniale.sql}) AS nb_especes_patrimoniales,
             max(${DATE})::text AS derniere_observation
      FROM sites s
      LEFT JOIN export_obs.webobs w ON ST_Intersects(w.geom, s.geom) AND ${c.map(x => `(${x})`).join(' AND ')}
      GROUP BY s.uuid_site`, params);

    const infos = new Map(sites.map(s => [s.uuid_site, s]));
    const tri = {
      especes: (a, b) => b.nb_especes - a.nb_especes,
      observations: (a, b) => b.nb_observations - a.nb_observations,
      especes_patrimoniales: (a, b) => b.nb_especes_patrimoniales - a.nb_especes_patrimoniales,
      derniere_observation: (a, b) => String(b.derniere_observation || '').localeCompare(String(a.derniere_observation || '')),
      moins_observes: (a, b) => a.nb_observations - b.nb_observations,
    }[args.tri];
    const resultats = lignes
      .map(l => ({ uuid_site: l.uuid_site, code: infos.get(l.uuid_site).code, nom: infos.get(l.uuid_site).nom, ...l,
        nb_observations: Number(l.nb_observations), nb_especes: Number(l.nb_especes),
        nb_especes_protegees: Number(l.nb_especes_protegees), nb_especes_menacees: Number(l.nb_especes_menacees),
        nb_especes_patrimoniales: Number(l.nb_especes_patrimoniales) }))
      .filter(l => args.tri === 'moins_observes' || l.nb_observations > 0)
      .sort((a, b) => tri(a, b) || String(a.code).localeCompare(String(b.code)));
    const avecObservation = lignes.filter(l => Number(l.nb_observations) > 0).length;
    return resultat(resultats.slice(0, args.limite), {
      source: await periodeDonnees(),
      sites_croises: sites.length, sites_avec_observation: avecObservation,
      note: args.espece ? 'Observations sensibles (localisation protégée) non prises en compte pour la recherche d\'une espèce.' : undefined,
    });
  });
}

module.exports = { enregistrerRequetesWebobs, STATUTS };
