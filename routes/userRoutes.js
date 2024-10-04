// Description: Routes pour l'authentification des utilisateurs


// Fonctions et connexion à PostgreSQL
const { joinQuery, siteResearch } = require('../fonctions/fonctionsSites.js'); 

const express = require('express'); // Pour utiliser le routeur express
const router = express.Router();

const bcrypt = require('bcrypt'); // Pour hacher les mots de passe
const saltRounds = 10; // Nombre de rounds de sel pour bcrypt

const jwt = require('jsonwebtoken'); // Pour créer des tokens d'authentification

// Connexion à PostgreSQL
const pool = require('../dbPool/poolConnect.js');

// Fonctions pour l'authentification
const { authenticateToken } = require('../fonctions/fonctionsAuth.js'); 


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
  // console.log("---------> hashedPassword : " + hashedPassword);

  try {
    // Rechercher l'utilisateur par son nom d'utilisateur et si il existe
    const query = {
      text: 'SELECT identifiant, sal_hash, ref_gro_id FROM admin.salaries WHERE identifiant = $1;',
      values: [username],
    };
    
    const result = await pool.query(query);
    
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Utilisateur non trouvé' });
    }else{
      console.log("---------> result.rows[0] : ");
      console.log(result.rows[0]);
      const sal_hash = result.rows[0]["sal_hash"];

      // Créer une nouvel objet contenant uniquement l'identifiant
      const payload = { identifiant : result.rows[0]["identifiant"] };

      // Comparer le mot de passe saisi avec le mot de passe haché stocké
      const match = await bcrypt.compare(password, sal_hash);
    
      if (!match) {
        return res.status(400).json({ message: 'Mot de passe incorrect' });
      }else{
        // Création du token
        console.log("---------> payload : ");
        console.log(payload);

        const token = jwt.sign(payload, 'Cenc4W1ldLif3!$', { expiresIn: '1h' });
        res.status(200).json({ message: 'Connexion réussie', 
                                identifiant: result.rows[0]["identifiant"],
				groupe: result.rows[0]["ref_gro_id"],
                                token: token}
        );
      }
    }    
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la connexion' });
  }
});

// Route pour verifier un token
router.get("/me", authenticateToken, (req, res) => {
  console.log("------------------------------ me! ------------------------------");

  console.log("req.token : ");
  console.log(req.token);

  console.log("req.tokenInfos : ");
  console.log(req.tokenInfos);

  const SelectFields = "SELECT nom, prenom, identifiant ";
  const FromTable = "FROM admin.salaries ";
  const where = "WHERE identifiant = $1";

  let queryObject = {
    text: joinQuery(
      SelectFields,
      FromTable,
      where
    ),
    values: [req.tokenInfos["identifiant"]],
  }

  // console.log("queryObject : ", queryObject);

  siteResearch(
      pool,
      { query: queryObject, message: "auth/me" },
      (message, resultats) => {
        if (resultats.length > 0) {
          const json = JSON.stringify(resultats[0]);
          // console.log(json);
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(json);
        } else {
          const json = JSON.stringify([]);
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(json);
        }
      }
  );
});

// Route pour se déconnecter
router.get("/logout", authenticateToken, (req, res) => {
  const insertReq ="INSERT INTO admin.blacklist_token (bla_token, bla_identifiant) VALUES ($1, $2);";
  
  queryObject = {
      text: insertReq,
      values: [req.token, req.tokenInfos["identifiant"]],
  };

  siteResearch(
      pool,
      { query: queryObject, message: "auth/logout" },
      (message, resultats) => {
        if (message !== "") {
          const json = JSON.stringify([]);
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(json);
        }
      }
  );
});

module.exports = router;
