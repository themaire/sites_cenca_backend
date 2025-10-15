# Utilise une image officielle de Node.js 20.18
FROM node:20.18

# Définit le répertoire de travail dans le conteneur
WORKDIR /app
RUN chown node:node /app

# Copie le fichier package.json et package-lock.json (si présent)
COPY package*.json ./

# Installe les dépendances
RUN npm install

# Copie le reste des fichiers de l'application
COPY routes/ ./routes/
COPY dbPool/ ./dbPool/
COPY fonctions/ ./fonctions/
COPY scripts/ ./scripts/
COPY .env .
COPY node_base_sites.js .

# Crée le répertoire pour les certificats SSL (si nécessaire)
RUN mkdir -p /etc/ssl/certs/si-10.cen-champagne-ardenne.org
RUN chown -R node:node /etc/ssl/certs/si-10.cen-champagne-ardenne.org

 # Montage du stockage persistant
RUN mkdir -p /mnt/storage_data/app/
RUN chown node:node /mnt/storage_data/app/

# Change vers l'utilisateur non-root
USER node

# Expose le port sur lequel l'application écoute
EXPOSE 8889

# Commande pour lancer l'application
CMD ["node", "node_base_sites.js"]
