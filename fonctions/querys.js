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

module.exports = { generateUpdateQuery };