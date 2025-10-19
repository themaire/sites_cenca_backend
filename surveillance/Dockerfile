# Utiliser une image Node.js légère
FROM node:18-alpine

# Créer le répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances
COPY surveillance/package*.json ./

# Installer les dépendances
RUN npm install --only=production

# Copier le code source
COPY surveillance/ ./surveillance/

# Créer un utilisateur non-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S surveillance -u 1001

# Changer les permissions
RUN chown -R surveillance:nodejs /app

# Utiliser l'utilisateur non-root
USER surveillance

# Exposer le port pour healthcheck
EXPOSE 3000

# Démarrer l'application
CMD ["node", "surveillance/surveillance.js"]