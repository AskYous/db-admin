const pool = async () => {
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
module.exports.getSchemas = async () => {
    return query("SELECT schema_name FROM information_schema.schemata");
}

/**
 * Gets all the tables in the given schema.
 * @param {string} schema the schema to get the tables from.
 */
module.exports.getTablesInSchema = async (schema) => {
    return query("SELECT * FROM information_schema.tables WHERE table_schema = $1", [schema]);
}

/**
 * Gets all the records from the given table. 
 * WARNING: This is NOT safe from sequel injection.
 * @param {string} tableName the table to get the records from.
 */
module.exports.getRecords = async (table) => {
    return query(`SELECT * FROM ${table}`);
}

/**
 * Gets the columns in the given table.
 * @param {string} table the table to get the columns for.
 */
module.exports.getColumns = async (table) => {
    return query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name = $1", [table]);
}

/**
 * Gets the columns and records from a table. This is done in one network request.
 * NOTE: This does not protect from SQL injection.
 * @param {string} table the table name
 */
module.exports.getColumnsAndRecords = async (table) => {
    return query(`
    SELECT column_name,data_type FROM information_schema.columns WHERE table_name = '${table}';
    SELECT * FROM ${table};
    `);
};

module.exports.query = query;

/**
 * Executes a query against the database.
 * @param {string} query the query to execute
 * @param {string[]} vars variables to use in prepared statement
 */
async function query(query, vars) {
    const p = await pool();
    const queryResponse = await p.query(query, vars);
    p.end();
    return queryResponse;
};