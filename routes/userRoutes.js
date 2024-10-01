const express = require('express');
const router = express.Router();

const bcrypt = require('bcrypt');
const saltRounds = 10; // Nombre de rounds de sel pour bcrypt

// Connexion à PostgreSQL
const pool = require('../dbPool/poolConnect.js');

// Route pour créer un utilisateur avec un mot de passe haché
router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Hachage du mot de passe
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Insérer l'utilisateur dans la base de données
    const query = {
      text: 'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING *',
      values: [username, hashedPassword],
    };
    
    const result = await pool.query(query);
    
    res.status(201).json({ message: 'Utilisateur créé avec succès', user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la création de l\'utilisateur' });
  }
});

// Route pour authentifier un utilisateur
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, saltRounds);
  console.log("---------> hashedPassword : " + hashedPassword);

  try {
    // Rechercher l'utilisateur par son nom d'utilisateur
    const query = {
      text: 'SELECT * FROM admin.salaries WHERE identifiant = $1',
      values: [username],
    };
    
    const result = await pool.query(query);
    
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Utilisateur non trouvé' });
    }else{
      console.log("---------> result.rows[0] : ");
      console.log(result.rows[0]);
    }

    const user = result.rows[0];
    
    // Comparer le mot de passe saisi avec le mot de passe haché stocké
    const match = await bcrypt.compare(password, user.sal_hash);
    
    if (!match) {
      return res.status(400).json({ message: 'Mot de passe incorrect' });
    }
    
    res.status(200).json({ message: 'Connexion réussie', identifiant: user.identifiant });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la connexion' });
  }
});


module.exports = router;