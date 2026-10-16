# Serveur MCP cenca-sites (lecture seule PostgreSQL/PostGIS)
FROM node:20.18-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dépendances d'abord (cache Docker tant que package*.json ne change pas)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Code de l'application. Le .env n'est PAS copié : il est fourni au lancement (docker-compose.yml)
COPY serveur_mcp.js dbPool.js ./
COPY fonctions/ ./fonctions/
COPY documentation/ ./documentation/

# Utilisateur non-root fourni par l'image node
USER node

EXPOSE 8891

# Santé : /health vérifie aussi la connexion PostgreSQL (l'adresse appelante doit être dans ALLOWED_IPS)
HEALTHCHECK --interval=60s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://' + (process.env.MCP_HOST || '127.0.0.1') + ':' + (process.env.MCP_PORT || 8891) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "serveur_mcp.js"]
