-- Vue ope.synthesesites : liste des projets d'un espace (route GET /sites/projets/uuid=:uuid/lite?webapp=1).
--
-- Corrige :
--   * la vue lisait opeautres_20260512 (sauvegarde du 12/05/2026) au lieu de opeautres : une vue suit
--     ses tables par OID, elle avait suivi le renommage du schéma. Les projets « autres » créés ou
--     ré-importés depuis n'apparaissaient pas ;
--   * projets webapp : la date affichée était vide dès qu'une opération n'avait pas de date
--     (ORDER BY date_debut DESC LIMIT 1 met les NULL en tête) → max(date_debut) ;
--   * objectif choisi par LIMIT 1 sans ORDER BY (aléatoire) → premier libellé par ordre alphabétique ;
--   * opérations invalides (validite = false) comptées dans le résumé des projets webapp → exclues.
-- Nettoie : CTE op_count et jointures aa/ga inutilisées, libellés d'actions factorisés,
-- 7 sous-requêtes corrélées → 2 LATERAL, UNION → UNION ALL (les trois branches sont disjointes).
-- Colonnes, noms et types inchangés : CREATE OR REPLACE conserve propriétaire et droits.

BEGIN;

CREATE OR REPLACE VIEW ope.synthesesites AS
WITH libelles_actions AS (
    -- Libellé hiérarchique d'une action : « grand-parent | parent | action »
    SELECT b.cd_action,
           CASE
               WHEN d.libelle IS NOT NULL THEN concat(d.libelle, ' | ', c.libelle, ' | ', b.libelle)
               WHEN c.libelle IS NOT NULL THEN concat(c.libelle, ' | ', b.libelle)
               ELSE b.libelle
           END::character varying AS libelle
      FROM ope.actions b
      LEFT JOIN ope.actions c ON c.cd_action = b.cd_sup
      LEFT JOIN ope.actions d ON d.cd_action = c.cd_sup
)
-- Projets « autres » (application MS Access) : une ligne par opération et localisation
SELECT ao.uuid_ope,
       ap.uuid_proj,
       ap.responsable,
       ap.statut,
       ap.annee,
       ap.nom AS projet,
       COALESCE(la.libelle,
                CASE WHEN length(ao.detail) > 30 THEN concat(left(ao.detail, 30), '[...]') ELSE ao.detail END
       )::character varying AS action,
       atp.libelle AS typ_projet,
       ati.lib_type AS typ_interv,
       ap.programme,
       to_char(ao.date_deb, 'DD-MM-YYYY') AS date_deb,
       al.cd_localisation,
       '1_AUT'::text AS generation,
       ap.date_crea,
       false AS webapp,
       ''::character varying AS uuid_site
  FROM opeautres.projets ap
  LEFT JOIN opeautres.operations ao ON ao.projet = ap.uuid_proj
  LEFT JOIN opeautres.localisations al ON al.uuid_ope = ao.uuid_ope
  LEFT JOIN libelles_actions la ON la.cd_action = ao.action
  LEFT JOIN ope.typ_projets atp ON atp.cd_type = ap.typ_projet
  LEFT JOIN ope.typ_interventions ati ON ati.cd_type = ao.typ_interv
 WHERE ao.validite IS NOT FALSE AND ap.validite IS NOT FALSE
UNION ALL
-- Anciens projets travaux (pro_webapp non vrai) : une ligne par opération
SELECT go.uuid_ope,
       gp.uuid_proj,
       gp.responsable,
       gp.statut,
       gp.annee,
       gp.nom AS projet,
       la.libelle AS action,
       gtp.libelle AS typ_projet,
       gti.lib_type AS typ_interv,
       gp.programme,
       to_char(go.date_debut, 'DD-MM-YYYY') AS date_deb,
       s.espace AS cd_localisation,
       '1_TVX'::text AS generation,
       gp.date_crea,
       gp.pro_webapp AS webapp,
       s.uuid_site
  FROM opegerer.projets gp
  LEFT JOIN opegerer.objectifs gob ON gob.projet = gp.uuid_proj
  LEFT JOIN opegerer.operations go ON go.objectif = gob.uuid_objectif
  LEFT JOIN libelles_actions la ON la.cd_action = go.action
  LEFT JOIN ope.typ_projets gtp ON gtp.cd_type = gp.typ_projet
  LEFT JOIN ope.typ_interventions gti ON gti.cd_type = go.typ_intervention
  LEFT JOIN sitcenca.sites s ON s.uuid_site = gp.site
 WHERE gp.pro_webapp IS NOT TRUE
   AND go.validite IS NOT FALSE AND gp.validite IS NOT FALSE
UNION ALL
-- Projets travaux de l'application web : une ligne par projet, opérations résumées
SELECT NULL::character varying AS uuid_ope,
       gp.uuid_proj,
       gp.responsable,
       '-'::character varying AS statut,
       gp.annee,
       (COALESCE(obj.libelle, 'Objectif opé non défini') || ' - ' || e.nom)::character varying AS projet,
       ops.actions::character varying AS action,
       gtp.libelle AS typ_projet,
       NULL::character varying AS typ_interv,
       gp.programme,
       CASE WHEN ops.nb = 0 THEN 'Pas d''opération' ELSE to_char(ops.date_derniere, 'DD-MM-YYYY') END AS date_deb,
       s.espace AS cd_localisation,
       '1_TVX'::text AS generation,
       gp.date_crea,
       gp.pro_webapp AS webapp,
       s.uuid_site
  FROM opegerer.projets gp
  LEFT JOIN sitcenca.sites s ON s.uuid_site = gp.site
  LEFT JOIN esp.espaces e ON e.uuid_espace = s.espace
  LEFT JOIN ope.typ_projets gtp ON gtp.cd_type = gp.typ_projet
  LEFT JOIN LATERAL (
        SELECT obope.libelle
          FROM opegerer.objectifs o
          JOIN opegerer.typ_objectifope obope ON obope.cd_type = o.obj_ope
         WHERE o.projet = gp.uuid_proj
         ORDER BY obope.libelle
         LIMIT 1
  ) obj ON true
  LEFT JOIN LATERAL (
        SELECT string_agg(DISTINCT ope.get_action_libelle(op.action), ' / ') AS actions,
               max(op.date_debut) AS date_derniere,
               count(*) AS nb
          FROM opegerer.operations op
         WHERE op.ref_uuid_proj = gp.uuid_proj
           AND op.validite IS NOT FALSE
  ) ops ON true
 WHERE gp.pro_webapp IS TRUE AND gp.validite IS NOT FALSE
 ORDER BY 5 DESC, 7, 6;

COMMIT;
