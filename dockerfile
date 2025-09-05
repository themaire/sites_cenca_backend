# Utilise une image officielle de Node.js 20.18
FROM node:20.18

# Définit le répertoire de travail dans le conteneur
WORKDIR /app

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


# Expose le port sur lequel l'application écoute
EXPOSE 8889

# Commande pour lancer l'application
CMD ["node", "node_base_sites.js"]
