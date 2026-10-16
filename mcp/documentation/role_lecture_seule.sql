-- =====================================================================================
-- Rôle PostgreSQL dédié au serveur MCP : SELECT uniquement.
-- C'est LA vraie barrière de sécurité : les garde-fous du serveur (transaction READ ONLY,
-- filtre SQL, masquage) ne sont qu'une défense supplémentaire.
--
-- La base est hébergée chez Lizmap SaaS (3liz) : admincenca n'a PAS le droit CREATEROLE.
--   * PARTIE 1 : à demander au support 3liz (création du rôle). Ils imposeront sans doute
--     leur convention de nommage, par ex. "mcpcenca@cen_champagne_ardenne".
--   * PARTIE 2 : à exécuter ensuite par admincenca (propriétaire des tables) pour accorder
--     les droits de lecture.
-- Puis dans mcp/.env : DB_USER=<nom du rôle> / DB_PASSWORD=<son mot de passe>.
-- =====================================================================================

-- ------------------------------------------------------------------ PARTIE 1 (3liz)
-- CREATE ROLE "mcpcenca@cen_champagne_ardenne" LOGIN PASSWORD '***' CONNECTION LIMIT 5
--   NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
-- GRANT CONNECT ON DATABASE lizmap_cenca_maps TO "mcpcenca@cen_champagne_ardenne";
-- -- Lecture seule forcée côté serveur, même si un client tente d'écrire :
-- ALTER ROLE "mcpcenca@cen_champagne_ardenne" SET default_transaction_read_only = on;
-- ALTER ROLE "mcpcenca@cen_champagne_ardenne" SET statement_timeout = '60s';
-- ALTER ROLE "mcpcenca@cen_champagne_ardenne" SET idle_in_transaction_session_timeout = '60s';
-- NB : surtout NE PAS ajouter ce rôle aux groupes __group__*@cenca.maps (ils ont INSERT/UPDATE/DELETE).

-- ------------------------------------------------------------------ PARTIE 2 (admincenca)
DO $$
DECLARE
  lecteur  text := 'mcpcenca@cen_champagne_ardenne';  -- à adapter au nom donné par 3liz
  schemas  text[] := ARRAY['sitcenca', 'esp', 'opegerer', 'ope', 'opeautres', 'docplan', 'ann', 'terr',
                           'n2000', 'chiro', 'hab', 'obsbiodiv', 'irenee', 'life_connexions', 'rqdb',
                           'librevo', 'mescomp', 'inpn', 'bd_topo', 'gestint', 'files', 'public'];
  s text;
BEGIN
  FOREACH s IN ARRAY schemas LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', s, lecteur);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO %I', s, lecteur);
    -- Tables créées plus tard par admincenca : lisibles automatiquement
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO %I', s, lecteur);
  END LOOP;

  -- Schéma admin : salariés et groupes seulement, SANS l'empreinte du mot de passe,
  -- et rien sur blacklist_token (jetons de session)
  EXECUTE format('GRANT USAGE ON SCHEMA admin TO %I', lecteur);
  EXECUTE format('GRANT SELECT (cd_salarie, nom, prenom, email, statut, identifiant, typ_fonction, sal_role, date_embauche, date_depart) ON admin.salaries TO %I', lecteur);
  EXECUTE format('GRANT SELECT ON admin.groupes, admin.salarie_groupes TO %I', lecteur);
END $$;

-- Vérifications
-- SELECT has_table_privilege('mcpcenca@cen_champagne_ardenne', 'sitcenca.sites', 'INSERT');      -- doit être false
-- SELECT has_column_privilege('mcpcenca@cen_champagne_ardenne', 'admin.salaries', 'sal_hash', 'SELECT'); -- doit être false
-- SELECT has_table_privilege('mcpcenca@cen_champagne_ardenne', 'admin.blacklist_token', 'SELECT'); -- doit être false
