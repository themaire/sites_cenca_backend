const express = require('express');
const router = express.Router();
const multer = require('multer');
const { spawn } = require('child_process');
const path = require('path');
const { get } = require('http');

// Chemin relatif du dossier à traiter par rapport à ce fichier 
// et non par rapport à la racine du projet
const PROCESS_FOLDER = '../extraction_fonciere'; // Chemin relatif du dossier de traitement Python
const A_TRAITER = path.join(__dirname, PROCESS_FOLDER, 'extractions/A_TRAITER'); // Chemin absolu du dossier à traiter
const PYTHON_VENV = path.join(__dirname, PROCESS_FOLDER, 'env_foncier/bin/python3');
const PYTHON_SCRIPT = path.join(__dirname, PROCESS_FOLDER, 'extraction_foncier.py');
console.log('Les fichiers à traiter seront stockés dans :');
console.log(A_TRAITER);

const UPLOAD = multer({ dest: A_TRAITER });

// Utilisation du MIDDLEWARE multer pour traiter les fichiers dans les applications Express
// Multer doit traiter un seul fichier téléchargé avec le champ de formulaire arrivant du POST nommé file
router.post('/process', UPLOAD.single('file'), (req, res) => {
  const file = req.file;
  const writeHisto = req.body.writeHisto;
  
  const data = {
    extraction_infos: 'infos', // Extraire les informations nécessaires du fichier ici
    list_parcells: [], // Extraire les parcelles du fichier ici
    where: 'WHERE ...' // Construire la clause WHERE ici
  };

  const pythonProcess = spawn(PYTHON_VENV, [PYTHON_SCRIPT, JSON.stringify(data), writeHisto]);

  console.log(`stdout: ${data}`);

  pythonProcess.stderr.on('data', (data) => {
    console.error(`stderr: ${data}`);
  });

  pythonProcess.on('close', (code) => {
    console.log(`le processus enfant a quitté avec le code erreur ${code}`);
    res.sendStatus(code === 0 ? 200 : 500);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`stderr: ${data}`);
  });

  pythonProcess.on('close', (code) => {
    console.log(`le processus enfant a quitté avec le code erreur ${code}`);
    res.sendStatus(code === 0 ? 200 : 500);
  });
});

module.exports = router;
