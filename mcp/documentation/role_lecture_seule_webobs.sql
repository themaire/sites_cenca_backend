-- =====================================================================================
-- Rôle PostgreSQL en lecture seule pour le serveur MCP sur la base WebObs (natobs, 192.168.1.25).
-- Le .env utilise pour l'instant "postgres" (superutilisateur) : un superutilisateur peut sortir
-- d'une transaction READ ONLY et exécuter des commandes système (COPY ... PROGRAM). Le MCP n'envoie
-- à natobs que des requêtes prédéfinies (aucun SQL libre), mais seul ce rôle est une vraie barrière.
--
-- À exécuter avec postgres sur natobs, puis dans mcp/.env :
--   WEBOBS_DB_USER=mcp_lecture / WEBOBS_DB_PASSWORD=<mot de passe choisi>
-- et reconstruire le conteneur : ./mcp/maintenance_mcp.sh reconstruire
-- =====================================================================================

CREATE ROLE mcp_lecture LOGIN PASSWORD 'à remplacer' CONNECTION LIMIT 5
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
ALTER ROLE mcp_lecture SET default_transaction_read_only = on;
ALTER ROLE mcp_lecture SET statement_timeout = '60s';
ALTER ROLE mcp_lecture SET idle_in_transaction_session_timeout = '60s';

GRANT CONNECT ON DATABASE natobs TO mcp_lecture;
-- Le MCP ne lit que export_obs.webobs ; public pour PostGIS (spatial_ref_sys, fonctions)
GRANT USAGE ON SCHEMA export_obs, public TO mcp_lecture;
GRANT SELECT ON export_obs.webobs TO mcp_lecture;
GRANT SELECT ON public.spatial_ref_sys TO mcp_lecture;
