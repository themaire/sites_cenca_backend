
function getRightId(table) {
    let pkName = '';
    if (['espaces', 'sites', 'projets', 'operations', 'objectifs','projets_mfu'].includes(table)) {
        if(table == 'espaces'){
            pkName = 'uuid_espace';
        } else if(table == 'sites'){
            pkName = 'uuid_site';
        } else if(table == 'projets'){
            pkName = 'uuid_proj';
        } else if(table == 'operations'){
            pkName = 'uuid_ope';
        } else if(table == 'objectifs'){
            pkName = 'uuid_objectif';
        } else if(table == 'projets_mfu'){
            pkName = 'pmfu_id';
        }
    } else if (table == 'localisations') {
        pkName = 'loc_id';
    } else if (table == 'salaries') {
        pkName = 'cd_salarie';
    } else {
        pkName = table.slice(0, -1);
    }
    return pkName;
}

function generateUpdateQuery(table, uuid, updateData) {
    let updateQuery = `UPDATE ${table} SET `;
    const setClauses = [];
    const values = [];

    Object.keys(updateData).forEach((key, index) => {
        setClauses.push(`${key} = $${index + 2}`); // +2 pour compenser l'UUID
        values.push(updateData[key]); // Ajouter la valeur
    });

    updateQuery += setClauses.join(", ");
    console.log();
    console.log("table : " + table);
    const tableParts = table.split('.');
    console.log("-----------> tableParts[1] : "  + tableParts[1]);

    const pkName = getRightId(tableParts[1]); // Nom de la clé primaire - Prendre le nom de la table sans le schema
    
    console.log('pkName final:', pkName); // Debug
    const whereClause = " WHERE " + pkName + " = $1";
    console.log("whereClause : " + whereClause);
    
    values.unshift(uuid); // Ajouter l'UUID comme première valeur

    const queryText = updateQuery + whereClause;

    console.log('------> queryText : ');
    console.log(queryText);

    return {
        text: queryText,
        values: values
    };
}

function generateInsertQuery(tableName, insertData, createUUID = true) {
    // Convertir l'objet en tableau de paires clé-valeur
    const entries = Object.entries(insertData);

    // Vérifier si entries contient des éléments
    if (entries.length === 0) {
        throw new Error("insertData ne peut pas être vide");
    }


    // Construire la requête SQL en utilisant (ou pas) gen_random_uuid() pour le premier élément
    let genUUID = ''; // Pour générer un UUID (ou pas)

    
    let insertQuery = '';
    if (createUUID) {
        console.log("mode : c'est la BDD qui créé le UUID");
        // Ignorer le premier élément pour les placeholders
        const [firstEntry, ...filteredEntries] = entries;

        // Il s'agit de la premiere colonne des champs donnés
        const firstEntryValue = firstEntry[0]; // Pour specifier la clé de la table comme premier élément (ou pas)

        // Reconstruire l'objet sans le premier élément
        const filteredData = Object.fromEntries(filteredEntries);
    
        // Générer les noms de colonnes et les valeurs
        const columns = Object.keys(filteredData).join(', ');
        const values = Object.values(filteredData);
    
        // Générer les placeholders pour les valeurs
        const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
        console.log('placeholders : ');
        console.log(placeholders);
        genUUID = 'gen_random_uuid(),';
        console.log('Valeur de la clé à inserer -> genUUID : ', genUUID);
        console.log('Nom de la clé de la table -> firstEntryValue :', firstEntryValue);

        insertQuery = `INSERT INTO ${tableName} (${firstEntryValue}, ${columns}) VALUES (${genUUID} ${placeholders});`;
        // Retourner l'objet de requête pour pg
        return {
            text: insertQuery,
            values: values
        };
    } else {
        console.log("mode : c'est PAS l'appli qui créé le UUID");
        // Reconstruire l'objet entier
        const data = Object.fromEntries(entries);
        console.log('pmfu_id dans data: ', data.pmfu_id);
        console.log('ref_pmfu_id dans data: ', data.ref_pmfu_id);
        // Générer les noms de colonnes et les valeurs
        const columns = Object.keys(data).join(', ');
        const values = Object.values(data);
        const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
        console.log('placeholders : ');
        console.log(placeholders);
        insertQuery = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders});`;
        // Retourner l'objet de requête pour pg
        return {
            text: insertQuery,
            values: values
        };
    }

}

function generateDeleteQuery(table, uuidName, id, idBisName = null, idBis = null) {
    let query = `DELETE FROM ${table} WHERE ${uuidName} = $1`;

    if (idBisName) {
        query += ` AND ${idBisName} = $2`;
        return {
            text: query,
            values: [id, idBis]
        };
    }

    return {
        text: query,
        values: [id]
    };
}

/**
 * Génère dynamiquement une requête SQL pour obtenir les champs d'une table,
 * @param {string} tableSchema - Schéma de la table (ex: 'opegerer')
 * @param {string} tableName - Nom de la table (ex: 'operations')
 */
function getTableColums(tableSchema, tableName) {
    // Récupérer dynamiquement la liste des colonnes dans l'ordre
    let sql = "SELECT column_name FROM information_schema.columns ";
    sql +=    "WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position";

    return {
        text: sql,
        values: [tableSchema, tableName]
    };
}

/**
 * Génère une requête SQL pour dupliquer une ligne d'une table en remplaçant la clé primaire.
 * @param {string} table - Nom de la table (ex: 'opegerer.operations')
 * @param {string} pkName - Nom de la clé primaire (ex: 'uuid_ope') à dupliquer
 * @param {string[]} columns - Liste des colonnes dans l'ordre, y compris la clé primaire
 * @param {string} id2clone - ID de la ligne à dupliquer
 * @param {string} newId - Nouvelle valeur de la clé primaire
 * @param {string[]} excludeFieldsGroups - Liste des noms de champs à exclure de la duplication (optionnel)
 * @returns {object} - Objet { text, values } pour pg
 */
function generateCloneQuery(table, pkName, columns, id2clone, newId = null, excludeFieldsGroups) {
    // columns est un tableau d'objets { column_name: '...' } venant de la fonction getTableColums qui sait récupérer les colonnes
    // On doit extraire les noms des colonnes de ces objets
    console.log('table :', table);
    console.log('Columns received for cloning :', columns);
    console.log('excludeFieldsGroups :', excludeFieldsGroups);

    // On extrait juste les noms des colonnes grace à map qui recréé un tableau seulement les valeurs de column_name
    const columnNames = columns.map(col => col.column_name);

    // Gestion de la nouvelle ID pour commencer
    if (!newId) { // Si pas de nouvelle ID fournie, on génère un UUID dans la requête
        newId = 'uuid_generate_v4()';
    } else { // Si une nouvelle ID est fournie, on l'utilise telle quelle
        newId = `'${newId}'`; // Ajouter des quotes pour la requête SQL
    }

    // Définir les groupes de champs à exclure. Il collecte les noms des champs à exclure en fonction des groupes spécifiés
    const fieldsToExclude = [];

    if (table === 'opegerer.operations') {
        if (excludeFieldsGroups && Array.isArray(excludeFieldsGroups)) {
            excludeFieldsGroups.forEach(group => {
                switch (group) {
                    case 'dates':
                        fieldsToExclude.push('date_debut', 'date_fin');
                        break;
                    case 'quantite':
                        fieldsToExclude.push('quantite');
                        break;
                    case 'unite':
                        fieldsToExclude.push('unite');
                        break;
                    case 'description':
                        fieldsToExclude.push('description');
                        break;
                    default:
                        console.warn(`Groupe de champs inconnu : ${group}`);
                        break;
                }
            });
        }
        
    } else if (table === 'opegerer.salaries') {
        if (excludeFieldsGroups && Array.isArray(excludeFieldsGroups)) {
            excludeFieldsGroups.forEach(group => {
                switch (group) {
                    case 'fonction':
                        fieldsToExclude.push('fonction');
                        break;
                }   
            });
        }
    }
    console.log('Champs à exclure :', fieldsToExclude);


    // On place la nouvelle valeur de PK en premier, puis on sélectionne toutes les autres colonnes sauf la PK et les champs exclus
    const columnsWithoutPk = columnNames.filter(col => 
        col !== pkName && !fieldsToExclude.includes(col)
    );
    
    const insertColumns = [pkName, ...columnsWithoutPk].join(', ');

    // On adapte le SELECT pour ajouter le suffixe à nom_mo (si pas exclu)
    const selectColumns = [
        newId,
        ...columnsWithoutPk.map(col => {
            if (col === 'nom_mo') {
                return `${col} || ' (cloné)'`;
            } else if (col === 'identifiant') {
                return `${col} || '_cloned'`;
            } else {
                return col;
            }
        })
    ].join(', ');

    const query = `
        INSERT INTO ${table} (${insertColumns})
        SELECT ${selectColumns}
        FROM ${table}
        WHERE ${pkName} = $1;`;

    return {
        text: query,
        values: [id2clone]
    };
}

/**
 * Génère une requête SQL pour dupliquer les financeurs ou les animaux d'une opération vers une nouvelle opération.
 * @param {string} checkboxTable - table de checkbox (ex: 'opegerer.operation_financeurs')
 * @param {string} oldUuidOpe - uuid_ope de l'opération à copier
 * @param {string} newUuidOpe - uuid_ope de la nouvelle opération
 * @returns {object} - Objet { text, values } pour pg
 */
function generateCloneCheckboxQuery(checkboxTable, oldUuidOpe, newUuidOpe) {
    const query = `
        INSERT INTO ${checkboxTable} (uuid_ope, checkbox_id)
        SELECT $2, checkbox_id
        FROM ${checkboxTable}
        WHERE uuid_ope = $1;
    `;
    return {
        text: query,
        values: [oldUuidOpe, newUuidOpe]
    };
}

module.exports = { generateUpdateQuery, generateInsertQuery, generateDeleteQuery, generateCloneQuery, getTableColums, generateCloneCheckboxQuery };
