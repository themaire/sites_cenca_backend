// Importer les modules nécessaires
const nodemailer = require('nodemailer');

// Charger les variables d'environnement
require('dotenv').config();

confTransporter = {
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT), // <-- conversion explicite
  secure: process.env.MAIL_SECURE === "true", // <-- conversion explicite
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASSWORD,
  },
  tls: {
    ciphers: 'SSLv3'
    // rejectUnauthorized: false // à activer seulement si tu as des soucis de certificat
  }
}
// console.log("Configuration du transporteur SMTP :", confTransporter);

// Créer un transporteur SMTP
const transporter = nodemailer.createTransport(confTransporter);

// Fonction pour envoyer un email
function sendEmail(to, subject, text, html) {
  const mailOptions = {
    from: process.env.MAIL_USER,
    to,
    subject,
    text,   // version texte brut
    html    // version HTML
  };

  return transporter.sendMail(mailOptions);
}

module.exports = {
  sendEmail,
};
// Ce fichier contient les fonctions pour envoyer des emails
// via Nodemailer, en utilisant les paramètres de configuration
// définis dans le fichier .env. Il exporte la fonction sendEmail
// qui prend en paramètres l'adresse email du destinataire, le sujet
// et le corps du message. Cette fonction utilise le transporteur
// SMTP configuré pour envoyer l'email. Les erreurs potentielles
// lors de l'envoi sont gérées par Nodemailer et peuvent être
// capturées par le code appelant.
