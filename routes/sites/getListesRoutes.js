// Listes de choix des formulaires (/selectvalues)
// Monté sur /sites dans node_base_sites.js
const express = require("express");
const router = express.Router();

// Fonctions et connexion à PostgreSQL
const { joinQuery, ExecuteQuerySite, reset } = require("../../fonctions/fonctionsSites.js");
const pool = require("../../dbPool/poolConnect.js");

// Les listes de choix pour les champs de formulaires
router.get("/selectvalues=:list/:option?", (req, res) => {
    let { SelectFields, FromTable, where, message, json } = reset();
    const list = req.params.list;
    const option = req.params.option;
    message = "/sites/selectvalues/" + list + "/" + option;
    console.log(`[DEBUG selectvalues] list='${String(list)}' option='${String(option)}' originalUrl='${req.originalUrl}'`);
    let order = undefined;

    console.log("Demande de la liste de choix de la table " + list + (option === undefined ? "" : " avec option " + option));

    SelectFields = "SELECT ";

    const simpleTables = [
        "ope.typ_actions",
        "ope.typ_financeurs",
        "ope.typ_projets",
        "ope.typ_roles",
        "opegerer.typ_enjeux",
        "opegerer.typ_hydrauliques",
        "opegerer.typ_infrastructures",
        "opegerer.typ_mecaniques",
        "opegerer.typ_objectifope",
        "opegerer.typ_objectifs",
        "sitcenca.typ_mfu",
        "esp.typ_espaces",
        "sitcenca.typ_sites",
    ];

    // Liste des libelles de la table commune des libelles
    const libelles_names = [
        "cadre_intervention",
        "chantier_nature",
        "unites",
        "pression_maitrise",
        "doc_type",
        "all",
        "out",
        "financement_agence",
        "types_acte",
        "type_proprio",
        "besoin_appuis",
        "validation_ca",
        "priorite",
        "status",
        "prochaine_etape",
        "territoire",
    ];

    // Sécurité (injection SQL) : `list` est concaténé dans le FROM, il doit donc être
    // une des tables connues de cette route. Ajouter ici toute nouvelle table de liste de choix.
    const allowedLists = [
        ...simpleTables,
        "docplan.typ_documents",
        "sitcenca.typ_proprietaires",
        "ope.actions",
        "ope.financeurs",
        "ope.typ_interventions",
        "opegerer.typ_amenagements",
        "typ_travauxsol",
        "opegerer.typ_troupeaux",
        "ope.listprogrammes",
        "opegerer.libelles",
        "sitcenca.libelles",
        "files.libelles",
        "admin.salaries",
        "terr.bassins_agences",
        "esp.typ_rgpt",
        "sitcenca.typ_ouvertures",
    ];
    if (!allowedLists.includes(list)) {
        return res.status(400).json({ success: false, message: "Liste de choix inconnue : " + list });
    }
    // files.libelles attend un identifiant numérique en option
    if (list == "files.libelles" && option !== undefined && !/^\d+$/.test(option)) {
        return res.status(400).json({ success: false, message: "Option invalide pour files.libelles : " + option });
    }
    const values = []; // Paramètres de la requête ($1, ...) : jamais de valeur utilisateur dans le texte SQL

    // Tables avec des noms de champs non normalisées
    if (list == "docplan.typ_documents") {
        SelectFields += "cd_type, libelle ";
        where = "order by libelle;";

    } else if (list == "sitcenca.typ_proprietaires") {
        SelectFields += "cd_type, libelle ";
        where = "order by cd_type;";
        
    } else if (simpleTables.includes(list)) {
        SelectFields += "cd_type, libelle ";

    } else if (list == "ope.actions") {
        SelectFields += "cd_action as cd_type, libelle, commentaire ";

    } else if (list == "ope.financeurs") {
        SelectFields += "cd_prog as cd_type, nom, annee, statut ";

    } else if (list == "ope.typ_interventions") {
        SelectFields += "cd_type, lib_type as libelle ";

    } else if (list == "opegerer.typ_amenagements") {
        SelectFields +=
            "cd_type as cd_type, libelle, categorie, libelle_pluriel ";

    } else if (list == "typ_travauxsol") {
        SelectFields +=
            "cd_type, libelle, val_tri, val_filtre, libelle_pluriel ";

    } else if (list == "opegerer.typ_troupeaux") {
        SelectFields +=
            "cd_type, libelle, coef_ugb, right(cd_supra,3) as code_supp, niveau ";

    } else if (list == "ope.listprogrammes") {
        SelectFields += "cd_programme as cd_type, cd_programme || ' - ' || libelle as libelle ";

    } else if ( // Tables de libelles
        list == "opegerer.libelles" || list == "sitcenca.libelles"
    ) {
        SelectFields += "lib_id as cd_type, lib_libelle as libelle ";

    } else if (list == "files.libelles") {
        SelectFields += "lib_id as cd_type, lib_libelle as libelle, lib_path as path, lib_field as field ";

    } else if (list == "admin.salaries") {
        if (option == "all") {
            SelectFields += "cd_salarie as cd_type, prenom || ' ' || nom as libelle ";
        } else {
            SelectFields += "cd_salarie as cd_type, prenom || ' ' || nom as libelle, case when typ_fonction not in ('COM', 'COMP', 'DIR', 'GEOM', 'RAF', 'SC', 'SECR', 'STAG') then 1 else 0 end as is_ope ";
        }
    
    } else if (list == "terr.bassins_agences") {
        SelectFields += "cd_bassin as cd_type, libelle ";
        order = "libelle";
    
    } else if (list == "esp.typ_rgpt") {
        SelectFields += "cd_rgpt as cd_type, libelle ";
        order = "libelle";
    
    } else if (list == "sitcenca.typ_ouvertures") {
        SelectFields += "cd_type, libelle ";
        order = "libelle";
    }

    FromTable = "FROM " + list + " ";

    if (order !== undefined) {
        where = "order by " + order;
    } else {
        // Filtrer sur des nouvelles valeurs précises
        if (list == 'opegerer.typ_objectifope') {
            where = "where cd_type in ('MENT', 'MRES', 'MCRE', 'IGEN', 'IGCR', 'IAEN', 'IACR') order by val_filtre;";
        } else if (list == 'ope.actions' && option == 1) { // Les actions comme Pâturage et opérations associées, Gestion hydraulique...
            where = "where cd_action like '%V2' and cd_action != '029_TRAV_SOL_V2' and cd_sup = '004_TRAV' ORDER BY val_tri ASC ;";
        } else if (list == 'ope.actions' && option == 'meca') {
            where = "where cd_sup = '027_TRAV_MECA_V2' order by val_tri;";
        } else if (list == "ope.actions" && option == "pat") {
            where = "where cd_sup = '028_TRAV_PAT_V2' order by val_tri;";
        } else if (list == "ope.actions" && option == "ame") {
            where = "where cd_sup = '008_TRAV_AMEN_V2' order by val_tri;";
        } else if (list == "ope.actions" && option == "hydro") {
            where = "where cd_sup = '005_TRAV_HYDRO_V2' order by val_tri;";
        } else if (list == "ope.actions" && option == "dech") {
            where = "where cd_sup = '200_TRAV_DECH_V2' order by val_tri;";
        } else if (list == "ope.typ_interventions") {
            where = "where val_filtre in (1, 2) order by lib_type;";
        } else if (list == "ope.listprogrammes") {
            where =
                "where left(cd_programme,2) in ('24', '25') order by cd_programme;";
        } else if (
            (list == "opegerer.libelles" || list == "sitcenca.libelles") &&
            libelles_names.includes(((option || "").split("-")[0]))
        ) {
            // Si l'option nécessite un filtrage supplémentaire
            // Mapping option -> liste d'IDs `lib_id`. Ajouter d'autres cas ici si besoin.
            const optionLibIdMap = {
                agence: [9, 10, 11, 12, 13, 7, 1],
                // ex: autre_option: [2,3,4],
            };

            const parts = (option || "").split("-");
            const base = parts[0] || ""; // ex 'financement_agence'
            const modifier = parts[1] || ""; // ex 'agence'

            let libnom_nom = "";
            if (modifier && modifier.includes("agence")) {
                libnom_nom = base;
            } else {
                libnom_nom = option || base;
            }

            // Construire la clause WHERE en utilisant `libnom_nom` (passé en paramètre $1)
            values.push(libnom_nom);
            where = "";
            where +=
                "where libnom_id = (SELECT libnom_id FROM " + list + "_nom" + " where libnom_nom = $1)";

            const mapKey = modifier || base;
            if (optionLibIdMap[mapKey]) {
                where += " and lib_id in (" + optionLibIdMap[mapKey].join(", ") + ")";
            }

            where += " order by lib_ordre;";

        } else if (list == "files.libelles" && option !== undefined) {
            values.push(option);
            where = "where libnom_id = $1 order by lib_ordre;";

        } else if (list == "admin.salaries" && option == undefined) {
            where = "where statut is true order by prenom;";

        } else if (list == "files.libelles") {
            where = "order by lib_ordre;";
        } else if (list == "sitcenca.typ_mfu") {
            where = "where val_tri is not null order by val_tri;"
        } else if (list == "sitcenca.typ_proprietaires") {
            where = "order by cd_type;";
        } else if (list == "docplan.typ_documents") {
            where = "order by libelle;";
        } else {
            where = "order by val_tri;";
        }
    }

    // Si l'option est dans la liste des libelles_names
    if (libelles_names.includes(option)) {
        console.log(
            "---------------Demande de la liste de choix de la table " +
            list +
            " pour l'option " +
            option
        );

        if (list == "admin.salaries" && option == "all") {
            where = "order by prenom;";
        }
    } else {
        console.log(
            "option " + option + " n'est pas dans la liste des libelles_names"
        );
    }

    const queryObject = {
        text: joinQuery(SelectFields, FromTable, where),
        values,
    };

    // Les listes de choix évoluent (ajout d'une valeur en base) : le navigateur ne doit pas
    // garder la réponse en cache, sinon la nouvelle valeur n'apparaît qu'après un Ctrl + Maj + R.
    res.setHeader("Cache-Control", "no-store");

    ExecuteQuerySite(
        pool,
        { message: message, query: queryObject },
        "select",
        (resultats, message) => {
            if (resultats.length > 0 || message == "ok") {
                const json = JSON.stringify(resultats);
                // console.log(json);
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader(
                    "Content-Type",
                    "application/json; charset=utf-8"
                );
                res.end(json);
            } else {
                const json = JSON.stringify([]);
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader(
                    "Content-Type",
                    "application/json; charset=utf-8"
                );
                res.end(json);
            }
        }
    );
});


module.exports = router;
