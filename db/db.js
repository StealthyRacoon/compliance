const dotenv = require("dotenv");
dotenv.config();

const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.normalize(process.env.DB_PATH);

const sqlite = new sqlite3.Database(dbPath, (err) => {

    if (err) {
        console.error("Could not connect to database:", err);
    }
    else {
        console.log("Connected to SQLite database");
    }
});

// --------------------------------------------------
// SQLITE SETTINGS
// --------------------------------------------------

sqlite.serialize(() => {

    sqlite.run("PRAGMA journal_mode = WAL;");
    sqlite.run("PRAGMA synchronous = NORMAL;");
    sqlite.run("PRAGMA temp_store = MEMORY;");
    sqlite.run("PRAGMA foreign_keys = ON;");
});

// --------------------------------------------------
// INIT TABLES
// --------------------------------------------------

sqlite.serialize(() => {

    sqlite.run(`
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            payload TEXT,
            attempts INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    sqlite.run(`
        CREATE TABLE IF NOT EXISTS sites (
            site_id TEXT PRIMARY KEY,
            display_name TEXT,
            web_url TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    sqlite.run(`
        CREATE TABLE IF NOT EXISTS drives (
            drive_id TEXT PRIMARY KEY,
            site_id TEXT,
            drive_name TEXT,
            web_url TEXT,
            delta_link TEXT,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    sqlite.run(`
        CREATE TABLE IF NOT EXISTS script_registry (
            job_type TEXT PRIMARY KEY,
            script_path TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            version TEXT DEFAULT 'v1',
            description TEXT,
            config TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

// --------------------------------------------------
// QUERY HELPERS
// --------------------------------------------------

function query(sql, params = []) {

    return new Promise((resolve, reject) => {

        sqlite.all(sql, params, (err, rows) => {

            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function get(sql, params = []) {

    return new Promise((resolve, reject) => {

        sqlite.get(sql, params, (err, row) => {

            if (err) reject(err);
            else resolve(row);
        });
    });
}

function execute(sql, params = []) {

    return new Promise((resolve, reject) => {

        sqlite.run(sql, params, function (err) {

            if (err) reject(err);
            else resolve(this);
        });
    });
}

// --------------------------------------------------
// EXPORTS
// --------------------------------------------------

module.exports = {
    query,
    get,
    execute
};