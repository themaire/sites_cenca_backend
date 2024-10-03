// Connexion à PostgreSQL
const pool = require('../dbPool/poolConnect.js');

const jwt = require('jsonwebtoken'); // Pour créer des tokens d'authentification

const { siteResearch } = require('../fonctions/fonctionsSites.js'); 

// Middleware pour vérifier le token JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    req.token = authHeader && authHeader.split(' ')[1]; // Récupère le token (après 'Bearer ')

    if (!req.token) return res.status(401).json({ message: 'Token manquant' });

    const blackedTokenReq ="SELECT exists( SELECT bla_id FROM admin.blacklist_token where bla_token = $1 );";
  
    queryObject = {
        text: blackedTokenReq,
        values: [req.token],
    };

    // console.log("queryObject : ");
    // console.log(queryObject);

    siteResearch(
        pool,
        { query: queryObject, message: "test if token is NOT blacklisted." },
        (message, resultats) => {

          // console.log("resultats : ");
          // console.log(resultats);

          if (resultats[0]["exists"] === false) { // Vérifie le token si on le trouve pas dans la blacklist
            jwt.verify(req.token, 'Cenc4W1ldLif3!$', (err, decodedToken) => {
              if (err) return res.status(403).json({ message: 'Token probablement expiré ou incorrect ( ' + err + ' )' });
              req.tokenInfos = decodedToken;  // Stocke les infos du token décodé dans req.user
              next();  // Passe à la prochaine étape (route ou autre middleware)
            });
          } else {
            console.log("Token invalide");
            return res.status(403).json({ message: 'Token blacklisté' });
          }
        }
    );






    
  };

module.exports = { authenticateToken };