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
            scan_run_id TEXT,
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
        );
    `);


    sqlite.run(`
        CREATE TABLE IF NOT EXISTS drives (
            drive_id TEXT PRIMARY KEY,
            site_id TEXT NOT NULL,

            drive_name TEXT,
            web_url TEXT,

            delta_link TEXT,
            status TEXT DEFAULT 'pending',

            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            last_error TEXT,

            FOREIGN KEY (site_id) REFERENCES sites(site_id)
                ON DELETE CASCADE
        );
    `);


    sqlite.run(`
       CREATE TABLE IF NOT EXISTS files (
            file_id TEXT PRIMARY KEY,

            site_id TEXT NOT NULL,
            drive_id TEXT NOT NULL,

            name TEXT,
            web_url TEXT,

            mime_type TEXT,
            size INTEGER,
            last_modified TEXT,

            raw_data TEXT,

            metadata TEXT,
            needs_enrichment INTEGER DEFAULT 1,

            last_scanned_at TEXT,
            last_seen_run_id TEXT,

            FOREIGN KEY (site_id) REFERENCES sites(site_id),
            FOREIGN KEY (drive_id) REFERENCES drives(drive_id)
        );
    `);


    sqlite.run(`
        CREATE TABLE IF NOT EXISTS scan_runs (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running',

            started_at TEXT DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT
        );
    `);


    sqlite.run(`
       CREATE TABLE IF NOT EXISTS scan_events (
            id TEXT PRIMARY KEY,

            scan_run_id TEXT,
            site_id TEXT,
            drive_id TEXT,
            file_id TEXT,

            event_type TEXT,

            old_status TEXT,
            new_status TEXT,

            file_name TEXT,
            file_path TEXT,
            mime_type TEXT,
            size INTEGER,

            metadata TEXT,

            created_at TEXT DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (scan_run_id) REFERENCES scan_runs(id),
            FOREIGN KEY (site_id) REFERENCES sites(site_id),
            FOREIGN KEY (drive_id) REFERENCES drives(drive_id),
            FOREIGN KEY (file_id) REFERENCES files(file_id)
        );
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
        );
    `);


    sqlite.run(`
        CREATE INDEX IF NOT EXISTS idx_files_drive_id ON files(drive_id);
    `);
    sqlite.run(`
        CREATE INDEX IF NOT EXISTS idx_files_needs_enrichment ON files(needs_enrichment);
    `);
    sqlite.run(`
       CREATE INDEX IF NOT EXISTS idx_files_drive_enrichment ON files(drive_id, needs_enrichment);
    `);

    sqlite.run(`
       CREATE INDEX IF NOT EXISTS idx_drives_site_id ON drives(site_id);
    `);
    sqlite.run(`
       CREATE INDEX IF NOT EXISTS idx_drives_status ON drives(status);
    `);

    sqlite.run(`
       CREATE INDEX IF NOT EXISTS idx_scan_events_run_id ON scan_events(scan_run_id);
    `);
    sqlite.run(`
       CREATE INDEX IF NOT EXISTS idx_scan_events_file_id ON scan_events(file_id);
    `);

    sqlite.run(`
        INSERT OR IGNORE INTO script_registry (
                job_type,
                script_path,
                enabled,
                version,
                description
            )
            VALUES (
                'discover_sites',
                './scripts/discoverSites.js',
                1,
                'v1',
                'Initial site discovery from Microsoft Graph'
            );
    `);

    sqlite.run(`
       
            INSERT OR IGNORE INTO script_registry (
                job_type,
                script_path,
                enabled,
                version,
                description
            )
            VALUES (
                'discover_drives',
                './scripts/discoverDrives.js',
                1,
                'v1',
                'Discovers document libraries (drives) for a site'
            );
    `);

    sqlite.run(`
      INSERT OR IGNORE INTO script_registry (
                job_type,
                script_path,
                enabled,
                version,
                description
            )
            VALUES (
                'scan_drive',
                './scripts/scanDrive.js',
                1,
                'v1',
                'Scans all files in a drive and writes compliance events'
            );
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

let writeQueue = Promise.resolve();

function execute(sql, params = []) {

    writeQueue = writeQueue.then(() => {
        return new Promise((resolve, reject) => {

            sqlite.run(sql, params, function (err) {

                if (err) reject(err);
                else resolve(this);
            });

        });
    });

    return writeQueue;
}

// --------------------------------------------------
// EXPORTS
// --------------------------------------------------

module.exports = {
    query,
    get,
    execute,
    sqlite
};