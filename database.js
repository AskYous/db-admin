const Record = require("./record.class");
const pool = () => {
    const fs = require("fs");
    let dbaConfig;
    let dbConfig;
    try {
        dbaConfig = JSON.parse(fs.readFileSync("./dba.config.json", "utf8"));
        dbConfig = dbaConfig.connections[dbaConfig.connection];
    } catch (e) {
        throw new Error(
            "Error getting config file. Are you sure you created a dba.config.json file? \n"
            + "If not, please see the sample-dba.config.json file as an example. \n"
        );
    }
    const { Pool, Client } = require('pg')

    const pool = new Pool({
        user: dbConfig.username,
        host: dbConfig.host,
        database: dbConfig.database,
        password: dbConfig.password,
        port: dbConfig.port,
        ssl: dbConfig.ssl,
    })
    return pool;
};

/**
 * Gets all the schemas in the database.
 */
module.exports.getSchemas = () => {
    return module.exports.query("SELECT schema_name FROM information_schema.schemata");
}

/**
 * Gets all the tables in the given schema.
 * @param {string} schema the schema to get the tables from.
 */
module.exports.getTablesInSchema = (schema) => {
    return module.exports.query("SELECT * FROM information_schema.tables WHERE table_schema = $1", [schema]);
}

/**
 * Gets all the records from the given table. 
 * WARNING: This is NOT safe from sequel injection.
 * @param {string} tableName the table to get the records from.
 */
module.exports.getRecords = async (schema, table) => {
    return module.exports.query(`SELECT * FROM ${schema}.${table}`);
}

/**
 * Gets the columns in the given table.
 * @param {string} table the table to get the columns for.
 */
module.exports.getColumns = (schema, table) => {
    return module.exports.query(`
        SELECT *
        FROM information_schema.columns
        WHERE table_schema = $1
        AND table_name = $2
    `, [schema, table]);
}

/**
 * Gets the columns of a table and a record with the given id.
 * @param {string} table the table name
 * @param {number} recordId the record id to get
 */
module.exports.getRecord = (schema, table, recordId) => {
    return module.exports.query(`SELECT * FROM ${schema}.${table} WHERE id = ${recordId};`);
}

module.exports.getColumnsAndRecord = (schema, table, recordId) => {
    return module.exports.query(`
        SELECT * 
            FROM information_schema.columns 
            WHERE table_schema = '${schema}' 
            AND table_name = '${table}';
        SELECT * 
            FROM ${schema}.${table} 
            WHERE id = ${recordId};
    `);
}

/**
 * Populates all foriegn attributes
 * NOTE: Does not protect against SQL injection.
 * @param {string} schema the schema where the records came from
 * @param {string} table the table where the records came from
 * @param {Record[]} records the records to populate
 */
module.exports.populateForeignValues = async (schema, table, records) => {
    if (records.length == 0) return;
    const foreignKeys = await module.exports.getForeignKeys(schema, table);
    const columns = Object.keys(records[0].original);
    for (let fk of foreignKeys.rows) {
        const ids = records
            .filter(r => r.original[fk.column_name] != null)
            .map(r => r.original[fk.column_name]);
        const values = await module.exports.query(`
            SELECT * 
            FROM ${fk.foreign_table_schema}.${fk.foreign_table_name}
            WHERE ${fk.foreign_column_name} IN (${ids})
        `);
        for (let r of records.filter(r => r.original[fk.column_name] != null)) {
            const index = columns.indexOf(fk.column_name);
            const newValue = values.rows.find(v => v[fk.foreign_column_name] == r.original[fk.column_name]);
            r.updateValue(index, new Record(newValue, fk.foreign_table_schema, fk.foreign_table_name));
        }
    }
}

/**
 * Gets the foreign keys of a table
 * @param {string} schema the schema of the table to get the keys from
 * @param {string} table the table to get the keys from
 */
module.exports.getForeignKeys = (schema, table) => {
    return module.exports.query(`
        SELECT
            kcu.column_name,
            ccu.table_schema AS foreign_table_schema,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name 
        FROM 
            information_schema.table_constraints AS tc 
            JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
        WHERE constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2;`,
        [schema, table]
    );
}

/**
 * Gets the foreign records of a specific table.
 * @param {string} schema the schema to get the records from
 * @param {string} table the table to get the records from
 * @return {{[x:string]: any[]} the foreign keys, indexed by the column
 * name of the given table
 */
module.exports.getForeignRecords = async (schema, table) => {
    const foreignKeys = await module.exports.getForeignKeys(schema, table);
    const queries = [];
    for (let fk of foreignKeys.rows) {
        queries.push(`SELECT * FROM ${fk.foreign_table_schema}.${fk.foreign_table_name}`);
    }
    let response = await module.exports.query(queries.join(";"));
    if (!Array.isArray(response)) { response = [response]; }
    const foreignRecords = {};
    for (let i = 0; i < foreignKeys.rows.length; i++) {
        const fk = foreignKeys.rows[i];
        const column = fk.column_name;
        foreignRecords[column] = response[i].rows;
    }
    return foreignRecords;
}
/**
 * Updates a record in the database.
 * NOTE: This does NOT protect against SQL injection.
 * @param {string} schema the schema of the record
 * @param {string} table the table of the record
 * @param {Record} record the record with its updated values
 */
module.exports.updateRecord = (schema, table, record) => {
    let i = 0;
    const columns = Object.keys(record.original).map(v => ` "${v}"`); // should be variables
    const values = record.values;
    const variables = values.map(x => `$${++i}`);
    let query = `
        UPDATE ${schema}.${table}
        SET (${columns}) = (${variables})
        WHERE id = ${record.id};
    `;
    return module.exports.query(query, values);
}

module.exports.insertRecord = (schema, table, record) => {
    let i = 0;
    let columns = Object
        .keys(record.original)
    let values = record.values;
    (function removeIds() {
        const idIndex = columns.findIndex(c => c.toLowerCase() == "id");
        columns.splice(idIndex, 1);
        values.splice(idIndex, 1);
    })();
    const variables = values.map(x => `$${++i}`);
    columns = columns.map(v => ` "${v}"`); // should be variables
    let query = `
        INSERT INTO ${schema}.${table} (${columns})
        VALUES (${variables})
        RETURNING id;
    `;
    return module.exports.query(query, values);
}

module.exports.deleteRecord = (schema, table, id) => {
    const query = `
        DELETE FROM ${schema}.${table}
        WHERE ID = $1
    `;
    return module.exports.query(query, [id]);
}

/**
 * Executes a query against the database.
 * @param {string} query the query to execute
 * @param {string[]} vars variables to use in prepared statement
 */
module.exports.query = async (query, vars) => {
    const p = await pool();
    const response = await p.query(query, vars);
    p.end();
    return response;
};
