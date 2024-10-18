// Description: Routes pour l'authentification des utilisateurs

// Charger les variables d'environnement
require('dotenv').config();

// Utiliser la clé secrète depuis le fichier .env
const secretKey = process.env.SECRET_KEY;
const saltRounds = process.env.SALT_ROUNDS;

// Fonctions et connexion à PostgreSQL
const { joinQuery, ExecuteQuerySite } = require('../fonctions/fonctionsSites.js'); 

const express = require('express'); // Pour utiliser le routeur express
const router = express.Router();

const bcrypt = require('bcrypt'); // Pour hacher les mots de passe

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
  // Route pour authentifier un utilisateur
  // Reçoit un objet avec les propriétés username et password dans le corps de la requête

  // Compare le mot de passe saisi avec le mot de passe haché stocké
  // Si les mots de passe correspondent, crée un token d'authentification
  // et le renvoie au client
  // Si les mots de passe ne correspondent pas, renvoie un message d'erreur
  // Si l'utilisateur n'existe pas, renvoie un message d'erreur
  
  // Si une erreur se produit, renvoie un message d'erreur

  // Sinon une réponse 200 OK est renvoyée avec :
  // le token d'authentification et un tableau contenant les infos de l'utilisateur et le message "Connexion réussie"
  
  const { username, password } = req.body;
  // const hashedPassword = await bcrypt.hash(password, saltRounds);
  // console.log("---------> hashedPassword : " + hashedPassword);


  // Rechercher l'utilisateur par son nom d'utilisateur et si il existe
  let querySQL = 'SELECT sal.identifiant, sal.sal_hash, salgro.gro_id FROM admin.salaries sal ';
  querySQL +=    'LEFT JOIN admin.salarie_groupes salgro ON sal.cd_salarie = salgro.cd_salarie ';
  querySQL +=    'LEFT JOIN admin.groupes gro ON salgro.gro_id = gro.gro_id WHERE sal.identifiant = $1 order by salgro.gro_id DESC LIMIT 1;';
  
  const userQuery = {
    text: querySQL,
    values: [username],
  };
  ExecuteQuerySite(
    pool,
    { query: userQuery, message: "site/put/table=espace_site/uuid" },
    "select",
    async ( resultats, message ) => { // On a le droit de mettre async ici sur la fonction de rappel (callback)
      if (resultats.length !== 1) {
        return res.status(400).json({ message: 'Utilisateur non trouvé' });
      }else if (resultats.length === 1) {
        // console.log("---------> result.rows[0] : ");
        // console.log(result.rows[0]);
        const sal_hash = resultats[0]["sal_hash"];

        // Créer une nouvel objet contenant uniquement l'identifiant
        const payload = { identifiant : resultats[0]["identifiant"] };

        // Comparer le mot de passe saisi avec le mot de passe haché stocké
        const match = await bcrypt.compare(password, sal_hash);
      
        if (!match) {
          return res.status(400).json({ message: 'Mot de passe incorrect' });
        }else{
          // Création du token
          // console.log("---------> payload : ");
          // console.log(payload);

          // Pas necessaire puisque la bibliothèque jsonwebtoken gère cela pour vous automatiquement
          // mais au cs où nous voudrier changer d'algorithme ou de type de token plus tard
          const header = {
            alg: 'HS256',
            typ: 'JWT'
          };
          const token = jwt.sign(payload, secretKey, { expiresIn: '1h' });
          res.status(200).json({ message: 'Connexion réussie', 
                                  identifiant: resultats[0]["identifiant"],
                                  groupe: resultats[0]["gro_id"],
                                  token: token}
          );
        }
      }    
    }
  );
});

router.get("/me", authenticateToken, (req, res) => {
  // Route pour vérifier un token
  // Reçoit un token d'authentification dans le header de la requête
  // Si le token est valide, renvoie les informations de l'utilisateur
  // Si le token n'est pas valide, renvoie un message d'erreur
  // Si une erreur se produit, renvoie un message d'erreur
  // Sinon une réponse 200 OK est renvoyée avec les informations de l'utilisateur

  console.log("------------------------------ me! ------------------------------");

  console.log("req.token : ");
  console.log(req.token);

  console.log("req.tokenInfos : ");
  console.log(req.tokenInfos);

  const SelectFields = "SELECT sal.nom, sal.prenom, sal.identifiant, salgro.gro_id ";
  
  let FromTable = "FROM admin.salaries sal ";
  FromTable +=    "LEFT JOIN admin.salarie_groupes salgro ON sal.cd_salarie = salgro.cd_salarie ";
  FromTable +=    "LEFT JOIN admin.groupes gro ON salgro.gro_id = gro.gro_id ";
  
  const where = "WHERE sal.identifiant = $1 ORDER BY salgro.gro_id desc limit 1;";

  let queryObject = {
    text: joinQuery( SelectFields, FromTable, where ),
    values: [req.tokenInfos["identifiant"]],
  }

  // console.log("queryObject : ", queryObject);

  ExecuteQuerySite(
      pool,
      { query: queryObject, message: "auth/me" },
      "select",
      ( resultats, message ) => {
        if (resultats.length > 0) {
          // console.log("resultats : ");
          // console.log(resultats);

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
router.get("/logout", authenticateToken, async (req, res) => {
  const insertReq ="INSERT INTO admin.blacklist_token (bla_token, bla_identifiant) VALUES ($1, $2);";
  
  queryObject = {
      text: insertReq,
      values: [req.token, req.tokenInfos["identifiant"]],
  };

   ExecuteQuerySite(
      pool,
      { query: queryObject, message: "auth/logout" },
      "insert",
      async ( resultats, message ) => {
        console.log("message : ");
        console.log(message);
        if (message === 'ok') {
          const json = JSON.stringify([]);
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(json);
        }
      }
  );
});

module.exports = router;
