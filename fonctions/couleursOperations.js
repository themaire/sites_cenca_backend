// Couleurs fixes des opérations de travaux, par type (ope.actions).
// Tableau commun à la carte de la fiche travaux (.docx, mapGenerator.js) et à la carte
// de l'application (front, map.component.ts) : toute modification doit être reportée
// côté front, sinon les deux cartes ne concordent plus.
//
// Les couleurs sont regroupées par famille (végétation en verts, pâturage en orangés/bruns,
// hydraulique en bleus...). Seule la fauche est jaune (blé, doré) : le jaune citron
// reste réservé au contour du site.

// Types de niveau 2 (opegerer.operations.action_2)
const COULEURS_ACTION_2 = {
    // Traitement de la végétation (027_TRAV_MECA_V2) : verts
    "201": "00796b", // Bûcheronnage
    "202": "c5e1a5", // Débroussaillage
    "203": "7cb342", // Broyage
    "204": "e8b923", // Fauche (jaune blé, plus doré que le contour du site)
    "205": "4db6ac", // Taille
    "206": "33691e", // Arrachage

    // Pâturage et opérations associées (028_TRAV_PAT_V2) : orangés / bruns
    "210": "e67e22", // Pâturage
    "211": "a0522d", // Intervention sur clôtures
    "212": "8d6e63", // Infrastructures pour le pâturage

    // Aménagement de site (008_TRAV_AMEN_V2) : violets / roses
    "220": "8e44ad", // Infrastructures d'accès au site
    "221": "e84393", // Équipements pédagogiques

    // Gestion des déchets (200_TRAV_DECH_V2) : gris
    "225": "616161", // Évacuation des déchets

    // Gestion hydraulique (005_TRAV_HYDRO_V2) : bleus
    "230": "1565c0", // Creusement
    "231": "42a5f5", // Curage
    "232": "00acc1", // Vidange
    "233": "0d47a1", // Intervention sur les berges
    "234": "5c6bc0", // Équipements de régulation des niveaux d'eau
    "235": "26c6da", // Pêche
    "236": "283593", // Digue
};

// Opération sans action_2 (anciennes saisies) ou type sans couleur
const COULEUR_PAR_DEFAUT = "90a4ae";

/** Couleur (hexadécimal sans "#") d'une opération, d'après son action_2 */
function couleurOperation(action2) {
    return COULEURS_ACTION_2[action2] || COULEUR_PAR_DEFAUT;
}

module.exports = {
    COULEURS_ACTION_2,
    COULEUR_PAR_DEFAUT,
    couleurOperation,
};
