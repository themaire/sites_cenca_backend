const express = require('express');
const fs = require('fs');
const path = require('path');


const router = express.Router();


// Route pour servir la documentation Markdown en HTML
// Exemple d'appel : /docs?file=traitement_fichiers/ope_shapefile.md&css=default
router.get('/', async (req, res) => {
  try {
    const fileParam = req.query.file;
    const cssParam = req.query.css;
    if (!fileParam) {
      return res.status(400).send('Paramètre "file" manquant.');
    }
    // Sécuriser le chemin (pas de .. ni de / au début)
    if (fileParam.includes('..') || fileParam.startsWith('/')) {
      return res.status(400).send('Chemin non autorisé.');
    }
    const docPath = path.join(__dirname, '../documentation', fileParam);
    if (!fs.existsSync(docPath)) {
      return res.status(404).send('Fichier de documentation introuvable.');
    }
    const mdContent = await fs.promises.readFile(docPath, 'utf-8');
    const { marked } = await import('marked');
    const htmlContent = marked.parse(mdContent);
    let styleBlock = '';
    if (cssParam === 'default') {
      styleBlock = `<style>
        body { font-family: Arial, sans-serif; background: #f9f9f9; color: #222; padding: 2em; }
        h1, h2, h3 { color: #2a7ae2; }
        pre, code { background: #eee; padding: 2px 4px; border-radius: 3px; }
        blockquote { border-left: 4px solid #2a7ae2; margin: 1em 0; padding: 0.5em 1em; background: #f4f8fb; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ccc; padding: 0.5em; }
      </style>`;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html><head><meta charset='utf-8'>${styleBlock}</head><body>${htmlContent}</body></html>`);
  } catch (err) {
    res.status(500).send('Erreur serveur : ' + err.message);
  }
});

module.exports = router;
