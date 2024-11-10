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
    console.log("table : " + table);
    const tableParts = table.split('.');
    let secondPart = '';
    if (['projets', 'operations'].includes(tableParts[1])) {
        if(tableParts[1] == 'projets'){
            secondPart = 'proj';
        } else if(tableParts[1] == 'operations'){
            secondPart = 'ope';
        }
    } else {
        secondPart = tableParts[1].slice(0, -1); // Récupérer la deuxième partie (nom de la table)
    }
    console.log("secondPart : " + secondPart);
    
    const whereClause = " WHERE uuid_" + secondPart + " = $1";
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

function generateInsertQuery(tableName, insertData) {
    // Convertir l'objet en tableau de paires clé-valeur
    const entries = Object.entries(insertData);

    // Ignorer le premier élément pour les placeholders
    const [firstEntry, ...filteredEntries] = entries;

    // Reconstruire l'objet sans le premier élément
    const filteredData = Object.fromEntries(filteredEntries);

    // Générer les noms de colonnes et les valeurs
    const columns = Object.keys(filteredData).join(', ');
    const values = Object.values(filteredData);

    // Générer les placeholders pour les valeurs
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');

    // Construire la requête SQL en utilisant gen_random_uuid() pour le premier élément
    const insertQuery = `INSERT INTO ${tableName} (${firstEntry[0]}, ${columns}) VALUES (gen_random_uuid(), ${placeholders});`;

    // Retourner l'objet de requête pour pg
    return {
        text: insertQuery,
        values: values
    };
}

module.exports = { generateUpdateQuery, generateInsertQuery };