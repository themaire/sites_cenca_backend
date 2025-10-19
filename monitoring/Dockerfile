# Dockerfile pour le service de monitoring
FROM node:18-alpine

# Métadonnées
LABEL maintainer="Nicolas Elie <n.elie@me.com>"
LABEL description="Service de monitoring pour l'API CENCA"

# Créer le répertoire de travail
WORKDIR /app

# Copier les fichiers de configuration
COPY package.json ./
COPY health-check.js ./

# Installer les dépendances
RUN npm install --only=production

# Créer le répertoire des logs avec les bonnes permissions avant de changer d'utilisateur
RUN mkdir -p /app/logs && chown node:node /app/logs

# Utiliser l'utilisateur node déjà présent dans l'image (UID 1000)
USER node

# Exposer le port pour les métriques (optionnel)
EXPOSE 3001

# Commande de démarrage par défaut (peut être surchargée)
CMD ["node", "health-check.js"]