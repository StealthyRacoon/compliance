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
        CREATE TABLE IF NOT EXISTS job_definitions (
            id TEXT PRIMARY KEY,

            name TEXT NOT NULL UNIQUE,
            description TEXT,

            enabled INTEGER DEFAULT 1,

            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
    `);

    sqlite.run(`
        CREATE TABLE IF NOT EXISTS job_definition_tasks (
            id TEXT PRIMARY KEY,

            job_definition_id TEXT NOT NULL,

            task_type TEXT NOT NULL,
            task_order INTEGER NOT NULL,

            depends_on_task_id TEXT,

            created_at TEXT DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (job_definition_id)
                REFERENCES job_definitions(id)
                ON DELETE CASCADE
        );
    `);

    sqlite.run(`
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,

            job_definition_id TEXT NOT NULL,

            job_type TEXT NOT NULL,

            status TEXT NOT NULL DEFAULT 'pending',

            payload TEXT,

            attempts INTEGER DEFAULT 0,

            last_error TEXT,
            failed_at TEXT,

            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (job_definition_id)
                REFERENCES job_definitions(id)
        );
    `);

    sqlite.run(`
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            task_definition_id TEXT,
            task_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            priority INTEGER DEFAULT 0,
            payload TEXT,
            attempts INTEGER DEFAULT 0,
            max_attempts INTEGER DEFAULT 5,
            run_after TEXT,
            depends_on_task_id TEXT,
            worker_id TEXT,
            claimed_at TEXT,
            started_at TEXT,
            completed_at TEXT,
            failed_at TEXT,
            last_error TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (job_id)
                REFERENCES jobs(id)
                ON DELETE CASCADE,

            FOREIGN KEY (task_definition_id)
                REFERENCES job_definition_tasks(id)
        );
    `);


    sqlite.run(`
        CREATE TABLE IF NOT EXISTS subtasks (
            id TEXT PRIMARY KEY,
            parent_task_type TEXT NOT NULL,
            script_path TEXT NOT NULL,
            task_order INTEGER DEFAULT 0,
            enabled INTEGER DEFAULT 1,
            description TEXT,

            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
    `);

    sqlite.run(`
        CREATE TABLE IF NOT EXISTS sites (
            site_id TEXT PRIMARY KEY,
            display_name TEXT,
            web_url TEXT,
            active INTEGER DEFAULT 1,
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
            last_error TEXT, subscription_id TEXT, subscription_expires_at TEXT, subscription_status TEXT DEFAULT 'none',

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

            last_modified TEXT,
            status TEXT,

            raw_data TEXT,

            metadata TEXT,
            needs_enrichment INTEGER DEFAULT 1,

            last_scanned_at TEXT,
            last_seen_task_id TEXT,

            FOREIGN KEY (site_id) REFERENCES sites(site_id),
            FOREIGN KEY (drive_id) REFERENCES drives(drive_id)
        );
    `);



    sqlite.run(`
       CREATE TABLE IF NOT EXISTS audit_log (
            id TEXT PRIMARY KEY,

            job_id TEXT,
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

            FOREIGN KEY (job_id) REFERENCES jobs(id),
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
        CREATE TABLE IF NOT EXISTS schedules (
            id TEXT PRIMARY KEY,

            name TEXT NOT NULL,

            job_definition_id TEXT NOT NULL,

            interval_ms INTEGER NOT NULL,

            enabled INTEGER DEFAULT 1,

            last_run_at TEXT,
            next_run_at TEXT,

            last_status TEXT,

            failure_count INTEGER DEFAULT 0,

            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (job_definition_id)
                REFERENCES job_definitions(id)
        );
    `);

    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);`);
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_tasks_job_id ON tasks(job_id);`);
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_tasks_depends ON tasks(depends_on_task_id);`);
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_tasks_worker  ON tasks(worker_id);`);
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run_at);`);
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_files_drive_id ON files(drive_id);`);
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_files_needs_enrichment ON files(needs_enrichment);`);
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_files_drive_enrichment ON files(drive_id, needs_enrichment);`);
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_drives_site_id ON drives(site_id);`);
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_drives_status ON drives(status);`);
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_file_id ON audit_log(file_id);`);
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks(status, priority, run_after);`);
    sqlite.run(`CREATE INDEX IF NOT EXISTS idx_subtasks_parent ON subtasks(parent_task_type, enabled, task_order);`);

    sqlite.run(` INSERT OR IGNORE INTO script_registry (job_type, script_path, enabled, version, description)
            VALUES (
                'discover_sites',
                './scripts/discoverSites.js',
                1,
                'v1',
                'Initial site discovery from Microsoft Graph'
            );
    `);

    sqlite.run(`
            INSERT OR IGNORE INTO script_registry (job_type, script_path, enabled, version, description)
            VALUES (
                'discover_drives',
                './scripts/discoverDrives.js',
                1,
                'v1',
                'Discovers document libraries (drives) for a site'
            );
    `);

    sqlite.run(`
      INSERT OR IGNORE INTO script_registry (job_type, script_path, enabled, version, description)
            VALUES (
                'scan_drive',
                './scripts/scanDrive.js',
                1,
                'v1',
                'Scans all files in a drive and writes compliance events'
            );
    `);

    sqlite.run(`
      INSERT OR IGNORE INTO script_registry (job_type, script_path, enabled, version, description)
            VALUES (
                'enrich_drive',
                './scripts/enrichDrive.js',
                1,
                'v1',
                'Gets all the metadata fields from SharePoint for all files created/modified after 01/01/2026'
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