function generateUpdateQuery(table, uuid, updateData) {
    let updateQuery = `UPDATE ${table} SET `;
    const setClauses = [];
    const values = [];

    Object.keys(updateData).forEach((key, index) => {
        setClauses.push(`${key} = $${index + 2}`); // +2 pour compenser l'UUID
        // console.log("ajout de", `${key} = $${index + 2}`)

        values.push(updateData[key]); // Ajouter la valeur
        // console.log("ajout de", updateData[key])
    });

    updateQuery += setClauses.join(", ");
    console.log();
    console.log("table : " + table);
    const tableParts = table.split('.');
    console.log("-----------> tableParts[1] : "  + tableParts[1]);

    let pkName = ''; // Nom de la clé primaire - Primary Key Name
    if (['espaces', 'sites', 'projets', 'operations', 'objectifs'].includes(tableParts[1])) {
        console.log("Table spéciale détectée:", tableParts[1]);

        if(tableParts[1] == 'espaces'){
            pkName = 'uuid_espace';
        } else if(tableParts[1] == 'sites'){
            pkName = 'uuid_site';
        } else if(tableParts[1] == 'projets'){
            pkName = 'uuid_proj';
        } else if(tableParts[1] == 'operations'){
            pkName = 'uuid_ope';
        } else if(tableParts[1] == 'objectifs'){
            pkName = 'uuid_objectif';
        }
    } else if (tableParts[1] == 'localisation_tvx') {
        pkName = 'loc_id';
    } else {
        // Si le nom de la clé est égale a celui de la table
        pkName = tableParts[1].slice(0, -1); // Récupérer la deuxième partie (nom de la table)
    }
    
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
    }else{
        console.log("mode : c'est l'appli qui créé le UUID");
        
        // Reconstruire l'objet entier
        const data = Object.fromEntries(entries);
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

module.exports = { generateUpdateQuery, generateInsertQuery };
