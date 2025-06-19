// Description: Routes pour l'authentification des utilisateurs

// Charger les variables d'environnement
require('dotenv').config();

// Utiliser la clé secrète depuis le fichier .env
const secretKey = process.env.SECRET_KEY;
const saltRounds = process.env.SALT_ROUNDS;
const authorizedDomains = process.env.AUTHORIZED_DOMAINS;

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

// Fonction pour envoyer un email
const { sendEmail } = require('../fonctions/fonctionsMails.js');

// let badPasswordMessage = "Le mot de passe doit contenir au moins 6 caractères, une majuscule, ";
// badPasswordMessage += "une minuscule, un chiffre et un caractère spécial.";
const passwordSpecifications = `
<strong>Le mot de passe n'est pas assez robuste.</strong><br>
Il doit contenir&nbsp;:
<ul>
  <li>Au moins <b>6 caractères</b></li>
  <li>Au moins <b>une lettre majuscule</b></li>
  <li>Au moins <b>une lettre minuscule</b></li>
  <li>Au moins <b>un chiffre</b></li>
  <li>Au moins <b>un caractère spécial</b> parmi : @ $ ! % * ? &</li>
</ul>
Aucun autre caractère n'est autorisé.
`;

const errorBddCreateUser = "Erreur lors de la création de l'utilisateur au niveau de la base de données.";

// Route pour créer un utilisateur avec un mot de passe haché
router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  // Vérification de la robustesse du mot de passe
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  if (!passwordRegex.test(password)) {
    return res.status(400).json({ message: badPasswordMessage });
  }

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
    res.status(500).json({ message: errorBddCreateUser });
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
  // Sinon une réponse 200 OK est renvoyée avec le token d'authentification
  // Fin
  
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
    { query: userQuery, message: "/auth/login" },
    "select",
    async ( resultats, message ) => { // On a le droit de mettre async ici sur la fonction de rappel (callback)
      let messageError = 'Indentifiant ou mot de passe incorrect';
      if (resultats.length !== 1) {
        return res.status(400).json({ message: messageError });
      } else if (resultats.length === 1) {

        const sal_hash = resultats[0]["sal_hash"];
        
        // Si le hachage n'est pas vide dans la base de données pour l'utilisateur
        // alors on crée un token d'authentification
        if (sal_hash != null && sal_hash != "") {
          // Création du token

          // Créer une nouvel objet contenant uniquement l'identifiant
          const payload = { identifiant : resultats[0]["identifiant"] };

          const match = await bcrypt.compare(password, sal_hash);
          // console.log("---------> payload : ");
          // console.log(payload);

          // Pas necessaire puisque la bibliothèque jsonwebtoken gère cela pour vous automatiquement
          // mais au cs où nous voudrier changer d'algorithme ou de type de token plus tard
          // const header = {
          //   alg: 'HS256',
          //   typ: 'JWT'
          // };

          // Puis si le mot de passe correspond
          if (match) {
              const token = jwt.sign(payload, secretKey, { expiresIn: '1h' });
              return res.status(200).json({ message: 'Connexion réussie', 
                                      identifiant: resultats[0]["identifiant"],
                                      groupe: resultats[0]["gro_id"],
                                      token: token}
              );
          } else {
          return res.status(400).json({ message: messageError });
          }
        } else {
          return res.status(400).json({ message: messageError });
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

  const SelectFields = "SELECT sal.nom, sal.prenom, sal.identifiant, sal.cd_salarie, salgro.gro_id ";
  
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

// Route pour demander la réinitialisation du mot de passe
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email requis." });
  }

  // Vérifier que le domaine de l'email est autorisé
  const domain = email.split('@')[1];
  const allowedDomains = (authorizedDomains || '').split(',').map(d => d.trim().toLowerCase());
  if (!domain || !allowedDomains.includes(domain.toLowerCase())) {
    return res.status(400).json({ message: "Domaine de l'email non autorisé." });
  }

  // Vérifier si l'utilisateur existe
  const query = {
    text: 'SELECT email, identifiant FROM admin.salaries WHERE email = $1 and statut is true',
    values: [email],
  };
  try {
    console.log("Secret key pour le JWT : ", secretKey);

    const result = await pool.query(query);
    console.log("Résultat de la requête forgot-password :", result);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Aucun utilisateur avec cet email." });
    }

    // Générer un token de reset (ici un JWT, tu peux aussi utiliser uuid)
    const resetToken = jwt.sign({ email }, secretKey, { expiresIn: '60m' });

    // Ici tu pourrais stocker le token en base ou l'envoyer par email
    // TODO: Envoyer l'email avec le lien de reset

    const html = `
      <html>
        <body>
          <p>Bonjour,</p>
          <p>
            Cet email a été généré automatiquement, merci de ne pas répondre.<br>
            Voici votre lien de réinitialisation&nbsp;:<br><br>
            <a href="http://si-10.cen-champagne-ardenne.org:8070/reset-password?token=${resetToken}">Réinitialiser le mot de passe</a>
          </p>
        </body>
      </html>
      `;

    const text = "Veuillez utiliser un client mail compatible HTML pour voir ce message.";
    
    await sendEmail(
      email,
      'Réinitialisation de votre mot de passe',
      text,
      html
    );

    const response = {
        message: 'Un email de réinitialisation a été envoyé si l\'adresse existe.',
        identifiant: result.rows[0]["identifiant"],
        email: result.rows[0]["email"],
        token: resetToken
    };

    console.log("Une demande de mot de passe a été faite. Variable response envoyé au client : ");
    console.log(response);

    // res.setHeader("Access-Control-Allow-Origin", "*");
    // res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).json(response);
  } catch (err) {
    console.error(err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(500).json({ message: "Erreur serveur. " + err });
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ message: "Token et nouveau mot de passe requis." });
  }

  // Vérification de la robustesse du mot de passe
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  if (!passwordRegex.test(newPassword)) {
    return res.status(400).json({ message: '<strong>Le mot de passe n\'est pas assez robuste.</strong><br>' + passwordSpecifications });
  }

  try {
    // Vérifier et décoder le token
    const decoded = jwt.verify(token, secretKey);
    const email = decoded.email;

    // Hacher le nouveau mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, Number(saltRounds));

    // Mettre à jour le mot de passe dans la base
    const query = {
      text: 'UPDATE admin.salaries SET sal_hash = $1 WHERE email = $2 AND statut is true',
      values: [hashedPassword, email],
    };
    const result = await pool.query(query);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Utilisateur non trouvé ou inactif." });
    }

    res.status(200).json({ message: "Mot de passe réinitialisé avec succès." });
  } catch (err) {
    console.error(err);
    if (err.name === "TokenExpiredError") {
      return res.status(400).json({ message: "Le lien de réinitialisation a expiré." });
    }
    res.status(400).json({ message: "Token invalide ou erreur serveur." });
  }
});

module.exports = router;
