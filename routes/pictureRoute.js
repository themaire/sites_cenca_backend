const express = require("express");
const router = express.Router();
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// Charger les variables d'environnement
require('dotenv').config();

// Charger le dossier des fichiers depuis les variables d'environnement ou utiliser un dossier par défaut
const FILES_DIR_ENV = process.env.FILES_DIR_ENV || path.join(__dirname, 'files');

// Définir les dossiers à partir de la racine du projet
// Pour rappel, FILES_DIR_ENV est défini dans .env
const IMAGES_DIR = path.resolve(FILES_DIR_ENV, "photos");
const CACHE_DIR = path.resolve(FILES_DIR_ENV, "cache");

// S'assurer que le dossier cache existe
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Route pour servir les images redimensionnées
 */
router.get("/img", async (req, res) => {
    const { file, width } = req.query;
    console.log("Demande d'image " + file + " en largeur " + width);

    if (!file || !width) {
        return res.status(400).send("Paramètres 'file' et 'width' requis");
    }

    const w = parseInt(width);
    if (isNaN(w) || w <= 0) {
        return res.status(400).send("Largeur invalide");
    }

    const originalPath = path.join(IMAGES_DIR, file);
    const cachePath = path.join(CACHE_DIR, `${w}-${file}`);

    try {
        // Vérifie si le fichier existe déjà en cache
        if (fs.existsSync(cachePath)) {
            return res.sendFile(cachePath);
        }

        // Vérifie que l'image originale existe
        if (!fs.existsSync(originalPath)) {
            return res.status(404).send("Image originale introuvable");
        }

        // Redimensionne et écrit en cache
        await sharp(originalPath)
            .resize(w) // conserve les proportions
            .toFormat("jpeg", { quality: 80 })
            .toFile(cachePath);

        // Renvoie l'image mise en cache
        res.sendFile(cachePath);
    } catch (err) {
        console.error(err);
        res.status(500).send("Erreur lors du redimensionnement de l'image");
    }
});

module.exports = router;
