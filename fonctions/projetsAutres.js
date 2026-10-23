"use strict";

// Projets « autres » (tous les types sauf les travaux) : schéma PostgreSQL opeautres, saisi jusqu'ici
// par l'ancienne interface MS Access branchée sur la base.
// Un seul modèle pour tous les types : la nature de l'action est portée par les valeurs (action de
// l'arbre ope.actions, famille de cibles, indicateurs code/valeur), pas par des colonnes propres au type.
//
//   opeautres.projets ─< opeautres.operations ─< localisations    (lieux : vue opeautres.localisants)
//                                              ─< cibles_ope       (public visé ou compartiment écologique)
//                                              ─< eval_indicateurs (indicateur chiffré, ex. NBPER = 12)
//                                              ─< intervenants     (contact de l'annuaire + rôle)
//
// Les travaux (TRV) sont saisis dans opegerer (routes/sites/getTravauxRoutes.js), jamais ici.
// Les projets opeautres apparaissent aussi dans la vue ope.listeprojets (pro_webapp = false).

// Types de projets qu'on ne crée pas dans opeautres : TRV vit dans opegerer, NR (« Non renseigné ») = anciens projets sans type
const TYPES_EXCLUS = ["TRV", "NR"];

// Valeurs de opeautres.projets.statut (texte libre en base, mêmes valeurs que les projets travaux)
const STATUTS = ["Programmé", "En cours", "Terminé", "Annulé"];

// Branches de ope.actions conseillées pour chaque type de projet, tirées de l'usage réel
// (opérations des projets 2023+, racine de l'action) : le front les propose en premier,
// mais toute action non travaux reste acceptée (un projet de partenariat peut contenir une étude).
const RACINES_PAR_TYPE = {
    SEN: ["9"],               // Sensibilisation
    ETU: ["3", "10", "7"],    // Études et suivis, plans de gestion, faune sauvage
    POL: ["2", "6"],          // Police de l'environnement, déchets
    FON: ["1"],               // Foncier et conventionnement
    ACC: ["14"],              // Assistance technique et représentation
    PAR: ["15", "14", "12", "13", "11"], // Coordination, assistance, partenariats, diagnostics, bénévoles
    ADM: ["15", "14", "11"],
    AUT: [],
};

// Racine des actions travaux : réservée aux projets TRV (opegerer)
const RACINE_TRAVAUX = "004_TRAV";

// Arbre des actions hors travaux : chaque action avec sa racine et son niveau calculé.
// (ope.actions.niveau n'est pas fiable sur les anciennes branches, d'où le calcul par récursion)
const SQL_ARBRE_ACTIONS = `
    WITH RECURSIVE arbre AS (
        SELECT cd_action, cd_sup, libelle, commentaire, val_tri, cd_action AS racine, 1 AS profondeur
          FROM ope.actions
         WHERE cd_sup = '0' AND cd_action <> '${RACINE_TRAVAUX}'
        UNION ALL
        SELECT a.cd_action, a.cd_sup, a.libelle, a.commentaire, a.val_tri, arbre.racine, arbre.profondeur + 1
          FROM ope.actions a
          JOIN arbre ON a.cd_sup = arbre.cd_action AND a.cd_action <> arbre.cd_action
         WHERE arbre.profondeur < 6
    )`;

// Opérations complètes (avec leurs listes rattachées) ; $1 = uuid du projet ou de l'opération
function sqlOperations(colonneFiltre) {
    return `
    SELECT o.uuid_ope, o.projet AS uuid_proj, o.action,
           to_char(o.date_deb, 'YYYY-MM-DD') AS date_deb, to_char(o.date_fin, 'YYYY-MM-DD') AS date_fin,
           to_char(o.date_deb, 'DD/MM/YYYY') AS date_deb_str, to_char(o.date_fin, 'DD/MM/YYYY') AS date_fin_str,
           o.detail, o.typ_interv, ti.lib_type AS typ_interv_libelle, o.com_interv, o.validite,
           (WITH RECURSIVE chemin AS (
                SELECT cd_action, cd_sup, libelle, 1 AS n FROM ope.actions WHERE cd_action = o.action
                UNION ALL
                SELECT a.cd_action, a.cd_sup, a.libelle, chemin.n + 1
                  FROM ope.actions a JOIN chemin ON a.cd_action = chemin.cd_sup
                 WHERE chemin.cd_sup <> '0' AND a.cd_action <> chemin.cd_action AND chemin.n < 6)
            SELECT json_agg(json_build_object('cd_action', cd_action, 'libelle', libelle) ORDER BY n DESC) FROM chemin
           ) AS action_chemin,
           coalesce((SELECT json_agg(json_build_object('cd_localisation', l.cd_localisation, 'libelle', lo.libelle_loc,
                                                       'cat', lo.cat, 'code', lo.code) ORDER BY lo.val_tri, lo.libelle_loc)
                       FROM opeautres.localisations l
                       LEFT JOIN opeautres.localisants lo ON lo.id_loc = l.cd_localisation
                      WHERE l.uuid_ope = o.uuid_ope), '[]') AS localisations,
           coalesce((SELECT json_agg(json_build_object('typ_cible', c.typ_cible, 'libelle', tc.libelle, 'detail', c.detail)
                                     ORDER BY tc.val_filtre, tc.cd_type)
                       FROM opeautres.cibles_ope c
                       LEFT JOIN opeautres.typ_cibles tc ON tc.cd_type = c.typ_cible
                      WHERE c.operation = o.uuid_ope), '[]') AS cibles,
           coalesce((SELECT json_agg(json_build_object('uuid_indic', i.uuid_indic, 'typ_indicateur', i.typ_indicateur,
                                                       'libelle', t.libelle, 'evaluation', i.evaluation) ORDER BY t.libelle)
                       FROM opeautres.eval_indicateurs i
                       LEFT JOIN opeautres.typ_indicateurs t ON t.cd_indicateur = i.typ_indicateur
                      WHERE i.operation = o.uuid_ope), '[]') AS indicateurs,
           coalesce((SELECT json_agg(json_build_object('typ_role', it.typ_role, 'role_libelle', r.libelle,
                                                       'intervenant', it.intervenant, 'nom', a.nom) ORDER BY a.nom)
                       FROM opeautres.intervenants it
                       LEFT JOIN ope.typ_roles r ON r.cd_type = it.typ_role
                       LEFT JOIN ann.annuaire a ON a.uuid_ann = it.intervenant
                      WHERE it.operation = o.uuid_ope), '[]') AS intervenants
      FROM opeautres.operations o
      LEFT JOIN ope.typ_interventions ti ON ti.cd_type = o.typ_interv
     WHERE o.${colonneFiltre} = $1
     ORDER BY o.date_deb NULLS LAST, o.uuid_ope`;
}

// Projet complet avec ses opérations ; null si introuvable. db = pool ou client de transaction
async function lireProjet(db, uuidProj) {
    const projet = await db.query(
        `SELECT p.uuid_proj, p.code, p.nom, p.annee, p.statut, p.typ_projet, tp.libelle AS typ_projet_libelle,
                p.responsable, concat(s.prenom, ' ', s.nom) AS responsable_str, p.programme,
                p.createur, to_char(p.date_crea, 'YYYY-MM-DD') AS date_crea, p.validite
           FROM opeautres.projets p
           LEFT JOIN ope.typ_projets tp ON tp.cd_type = p.typ_projet
           LEFT JOIN admin.salaries s ON s.cd_salarie = p.responsable
          WHERE p.uuid_proj = $1`,
        [uuidProj]
    );
    if (!projet.rows.length) return null;
    const operations = await db.query(sqlOperations("projet"), [uuidProj]);
    return { ...projet.rows[0], ouvert_par: await ouvertPar(db, uuidProj), operations: operations.rows };
}

// Collègues ayant la fiche projet ouverte en modification dans l'interface MS Access : elle pose un verrou
// dans gestint.editions (table, uuid, compte) à l'ouverture et l'efface à la fermeture. La webapp ne pose
// pas de verrou et ne bloque rien : elle informe seulement. Un verrou peut rester si Access a planté.
async function ouvertPar(db, uuidProj) {
    const result = await db.query(
        `SELECT e.compte, concat(s.prenom, ' ', s.nom) AS nom
           FROM gestint.editions e
           LEFT JOIN admin.salaries s ON s.cd_salarie = e.compte
          WHERE e."table" = 'opeautres.projets' AND e.uuid = $1
          ORDER BY e.compte`,
        [uuidProj]
    );
    return result.rows;
}

// Opération complète ; null si introuvable
async function lireOperation(db, uuidOpe) {
    const result = await db.query(sqlOperations("uuid_ope"), [uuidOpe]);
    return result.rows[0] || null;
}

// Code salarié (admin.salaries.cd_salarie) de l'utilisateur connecté : le JWT ne porte que l'identifiant
async function codeSalarie(db, identifiant) {
    if (!identifiant) return null;
    const result = await db.query("SELECT cd_salarie FROM admin.salaries WHERE identifiant = $1", [identifiant]);
    return result.rows[0]?.cd_salarie || null;
}

const vide = (v) => v === undefined || v === null || v === "";

// Équivalent de la fonction Formatage de l'interface MS Access (module public_functions), appliqué aux
// textes libres avant écriture : dans opeautres, un retour à la ligne est stocké « | » (convention suivie
// par 352 détails d'opération contre 4 vrais retours à la ligne), les « || » sont fusionnés et la puce « • »
// devient « - ». Les apostrophes ne sont pas doublées : les requêtes sont paramétrées.
function formaterTexte(texte) {
    if (vide(texte)) return null;
    return String(texte)
        .replace(/\r\n|\n\r|\r|\n/g, "|")
        .replace(/•/g, "-")
        .replace(/\|{2,}/g, "|");
}

// Contrôle des champs d'un projet ; partiel = true pour une modification (champs absents conservés).
// Renvoie la liste des erreurs (vide si valide).
async function verifierProjet(db, corps, partiel = false) {
    const erreurs = [];
    if (!partiel || corps.nom !== undefined) {
        if (vide(corps.nom)) erreurs.push("nom obligatoire");
    }
    if (!partiel || corps.typ_projet !== undefined) {
        if (vide(corps.typ_projet)) erreurs.push("typ_projet obligatoire");
        else if (TYPES_EXCLUS.includes(corps.typ_projet)) erreurs.push(`typ_projet ${corps.typ_projet} non accepté ici (TRV : projets travaux)`);
        else {
            const t = await db.query("SELECT 1 FROM ope.typ_projets WHERE cd_type = $1", [corps.typ_projet]);
            if (!t.rows.length) erreurs.push("typ_projet inconnu : " + corps.typ_projet);
        }
    }
    if (!partiel || corps.annee !== undefined) {
        if (!Number.isInteger(Number(corps.annee)) || Number(corps.annee) < 1990 || Number(corps.annee) > 2100)
            erreurs.push("annee invalide");
    }
    if (!vide(corps.statut) && !STATUTS.includes(corps.statut)) erreurs.push("statut invalide (" + STATUTS.join(", ") + ")");
    if (!vide(corps.responsable)) {
        const s = await db.query("SELECT 1 FROM admin.salaries WHERE cd_salarie = $1", [corps.responsable]);
        if (!s.rows.length) erreurs.push("responsable inconnu : " + corps.responsable);
    }
    return erreurs;
}

// Contrôle des champs d'une opération et de ses listes ; partiel = true pour une modification
async function verifierOperation(db, corps, partiel = false) {
    const erreurs = [];
    if (!partiel || corps.action !== undefined) {
        if (vide(corps.action)) erreurs.push("action obligatoire");
        else {
            const a = await db.query(`${SQL_ARBRE_ACTIONS} SELECT 1 FROM arbre WHERE cd_action = $1`, [corps.action]);
            if (!a.rows.length) erreurs.push("action inconnue ou réservée aux travaux : " + corps.action);
        }
    }
    const dateDeb = corps.date_deb, dateFin = corps.date_fin;
    for (const [nom, d] of [["date_deb", dateDeb], ["date_fin", dateFin]])
        if (!vide(d) && isNaN(Date.parse(d))) erreurs.push(nom + " invalide (AAAA-MM-JJ)");
    if (!vide(dateDeb) && !vide(dateFin) && Date.parse(dateFin) < Date.parse(dateDeb)) erreurs.push("date_fin antérieure à date_deb");
    if (!vide(corps.detail) && String(corps.detail).length > 2000) erreurs.push("detail limité à 2000 caractères");
    if (!vide(corps.typ_interv)) {
        const t = await db.query("SELECT 1 FROM ope.typ_interventions WHERE cd_type = $1", [corps.typ_interv]);
        if (!t.rows.length) erreurs.push("typ_interv inconnu : " + corps.typ_interv);
    }

    // Listes rattachées : contrôlées seulement si fournies (tableaux)
    const listes = { localisations: corps.localisations, cibles: corps.cibles, indicateurs: corps.indicateurs, intervenants: corps.intervenants };
    const malFormees = Object.entries(listes).filter(([, liste]) => liste !== undefined && !Array.isArray(liste));
    if (malFormees.length) return erreurs.concat(malFormees.map(([nom]) => nom + " doit être un tableau"));

    if (corps.localisations?.length) {
        const ids = corps.localisations.map((l) => (typeof l === "string" ? l : l?.cd_localisation));
        const r = await db.query("SELECT id_loc FROM opeautres.localisants WHERE id_loc = ANY($1::text[])", [ids]);
        const connus = new Set(r.rows.map((x) => x.id_loc));
        for (const id of ids) if (!connus.has(id)) erreurs.push("localisation inconnue : " + id);
    }
    if (corps.cibles?.length) {
        const codes = corps.cibles.map((c) => c?.typ_cible);
        if (new Set(codes).size !== codes.length) erreurs.push("cible en double");
        const r = await db.query("SELECT cd_type FROM opeautres.typ_cibles WHERE cd_type = ANY($1::text[])", [codes]);
        const connus = new Set(r.rows.map((x) => x.cd_type));
        for (const c of codes) if (!connus.has(c)) erreurs.push("cible inconnue : " + c);
    }
    if (corps.indicateurs?.length) {
        const codes = corps.indicateurs.map((i) => i?.typ_indicateur);
        const r = await db.query("SELECT cd_indicateur FROM opeautres.typ_indicateurs WHERE cd_indicateur = ANY($1::text[])", [codes]);
        const connus = new Set(r.rows.map((x) => x.cd_indicateur));
        for (const c of codes) if (!connus.has(c)) erreurs.push("indicateur inconnu : " + c);
    }
    if (corps.intervenants?.length) {
        const cles = corps.intervenants.map((i) => i?.typ_role + "|" + i?.intervenant);
        if (new Set(cles).size !== cles.length) erreurs.push("intervenant en double (même rôle)");
        const roles = await db.query("SELECT cd_type FROM ope.typ_roles WHERE cd_type = ANY($1::text[])", [corps.intervenants.map((i) => i?.typ_role)]);
        const rolesConnus = new Set(roles.rows.map((x) => x.cd_type));
        const contacts = await db.query("SELECT uuid_ann FROM ann.annuaire WHERE uuid_ann = ANY($1::text[])", [corps.intervenants.map((i) => i?.intervenant)]);
        const contactsConnus = new Set(contacts.rows.map((x) => x.uuid_ann));
        for (const i of corps.intervenants) {
            if (!rolesConnus.has(i?.typ_role)) erreurs.push("rôle inconnu : " + i?.typ_role);
            if (!contactsConnus.has(i?.intervenant)) erreurs.push("contact de l'annuaire inconnu : " + i?.intervenant);
        }
    }
    return erreurs;
}

// Journal des modifications partagé avec l'interface MS Access (sa fonction Suivi_modif) :
// une ligne par écriture dans gestint.historiques, compte = code salarié, enregistrement = uuid du projet
// ou de l'opération. Tables principales : action « INSERT », « UPDATE » ou « DELETE » ; listes rattachées :
// « INSERT - Cible : 1.3 », comme Access (et « DELETE - … » pour un retrait).
async function journaliser(client, compte, table, enregistrement, action) {
    await client.query(
        `INSERT INTO gestint.historiques (uuid_histo, compte, date, "table", enregistrement, action)
         VALUES (gen_random_uuid()::text, $1, current_date, $2, $3, $4)`,
        [compte, table, enregistrement, action]
    );
}

// Listes rattachées à une opération : table, colonne de l'opération, lecture de l'existant, clé de
// comparaison, libellé du journal (format Access) et insertion
const LISTES_OPERATION = {
    localisations: {
        table: "opeautres.localisations",
        colonne: "uuid_ope",
        normaliser: (l) => ({ cd_localisation: typeof l === "string" ? l : l.cd_localisation }),
        cle: (l) => l.cd_localisation,
        libelle: (l) => "UUID localisation =" + l.cd_localisation,
        inserer: (client, uuidOpe, l) =>
            client.query("INSERT INTO opeautres.localisations (uuid_ope, cd_localisation) VALUES ($1, $2)", [uuidOpe, l.cd_localisation]),
    },
    cibles: {
        table: "opeautres.cibles_ope",
        colonne: "operation",
        normaliser: (c) => ({ typ_cible: c.typ_cible, detail: formaterTexte(c.detail) }),
        cle: (c) => c.typ_cible + "|" + (c.detail ?? ""),
        libelle: (c) => "Cible : " + c.typ_cible,
        inserer: (client, uuidOpe, c) =>
            client.query("INSERT INTO opeautres.cibles_ope (operation, typ_cible, detail) VALUES ($1, $2, $3)", [uuidOpe, c.typ_cible, c.detail]),
    },
    indicateurs: {
        table: "opeautres.eval_indicateurs",
        colonne: "operation",
        normaliser: (i) => ({ typ_indicateur: i.typ_indicateur, evaluation: vide(i.evaluation) ? null : String(i.evaluation) }),
        cle: (i) => i.typ_indicateur + "|" + (i.evaluation ?? ""),
        libelle: (i) => "Indicateur : " + i.typ_indicateur,
        inserer: (client, uuidOpe, i) =>
            client.query(
                "INSERT INTO opeautres.eval_indicateurs (uuid_indic, operation, typ_indicateur, evaluation) VALUES (gen_random_uuid()::text, $1, $2, $3)",
                [uuidOpe, i.typ_indicateur, i.evaluation]
            ),
    },
    intervenants: {
        table: "opeautres.intervenants",
        colonne: "operation",
        normaliser: (i) => ({ typ_role: i.typ_role, intervenant: i.intervenant }),
        cle: (i) => i.typ_role + "|" + i.intervenant,
        libelle: (i) => `Role : ${i.typ_role} (UUID intervenant =${i.intervenant})`,
        inserer: (client, uuidOpe, i) =>
            client.query("INSERT INTO opeautres.intervenants (operation, typ_role, intervenant) VALUES ($1, $2, $3)", [uuidOpe, i.typ_role, i.intervenant]),
    },
};

// Remplace les listes rattachées fournies (un tableau vide vide la liste ; une liste absente n'est pas touchée).
// Seules les différences sont journalisées (ajouts en INSERT, retraits en DELETE). client = client de transaction
async function ecrireListesOperation(client, uuidOpe, corps, compte) {
    for (const [nom, l] of Object.entries(LISTES_OPERATION)) {
        if (!Array.isArray(corps[nom])) continue;
        const anciens = (await client.query(`SELECT * FROM ${l.table} WHERE ${l.colonne} = $1`, [uuidOpe])).rows.map(l.normaliser);
        const nouveaux = [...new Map(corps[nom].map(l.normaliser).map((x) => [l.cle(x), x])).values()];
        const clesAnciennes = new Set(anciens.map(l.cle));
        const clesNouvelles = new Set(nouveaux.map(l.cle));
        await client.query(`DELETE FROM ${l.table} WHERE ${l.colonne} = $1`, [uuidOpe]);
        for (const x of nouveaux) await l.inserer(client, uuidOpe, x);
        for (const x of anciens.filter((x) => !clesNouvelles.has(l.cle(x))))
            await journaliser(client, compte, l.table, uuidOpe, "DELETE - " + l.libelle(x));
        for (const x of nouveaux.filter((x) => !clesAnciennes.has(l.cle(x))))
            await journaliser(client, compte, l.table, uuidOpe, "INSERT - " + l.libelle(x));
    }
}

module.exports = {
    TYPES_EXCLUS, STATUTS, RACINES_PAR_TYPE, SQL_ARBRE_ACTIONS, LISTES_OPERATION,
    lireProjet, lireOperation, codeSalarie, verifierProjet, verifierOperation, ecrireListesOperation, journaliser, formaterTexte, vide,
};
