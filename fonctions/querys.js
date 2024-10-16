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
    const secondPart = tableParts[1].slice(0, -1); // Récupérer la deuxième partie (nom de la table)
    const whereClause = " WHERE uuid_" + secondPart + " = $1";
    // console.log("whereClause : " + whereClause);
    
    values.unshift(uuid); // Ajouter l'UUID comme première valeur

    const queryText = updateQuery + whereClause;

    return {
        text: queryText,
        values: values
    };
}

function generateInsertQuery(table, uuid, insertData) {
    let insertQuery = `INSERT INTO ${table} (`;
    const columns = [];
    const values = [];
    const placeholders = [];

    Object.keys(insertData).forEach((key, index) => {
        columns.push(key);
        placeholders.push(`$${index + 2}`); // +2 pour compenser l'UUID
        values.push(insertData[key]); // Ajouter la valeur
    });

    insertQuery += columns.join(", ") + ", uuid) VALUES (";
    insertQuery += placeholders.join(", ") + ", $1)"; // $1 pour l'UUID

    values.unshift(uuid); // Ajouter l'UUID comme première valeur

    return {
        text: insertQuery,
        values: values
    };
}

module.exports = { generateUpdateQuery, generateInsertQuery };