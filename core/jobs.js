const db = require("../db/db");
const {sqlite} = require("../db/db");


// --------------------------------------------------

async function claimJob() {

    return new Promise((resolve, reject) => {

        sqlite.serialize(() => {

            sqlite.run(
                "BEGIN IMMEDIATE TRANSACTION",
                (beginErr) => {

                    if (beginErr) {
                        return reject(beginErr);
                    }

                    sqlite.get(`
                        SELECT *
                        FROM jobs
                        WHERE status = 'pending'
                        ORDER BY created_at ASC
                        LIMIT 1
                    `, [], (selectErr, job) => {

                        if (selectErr) {

                            sqlite.run("ROLLBACK");

                            return reject(selectErr);
                        }

                        if (!job) {

                            sqlite.run("COMMIT");

                            return resolve(null);
                        }

                        sqlite.run(`
                            UPDATE jobs
                            SET status = 'running',
                                attempts = attempts + 1,
                                updated_at = datetime('now')
                            WHERE id = ?
                              AND status = 'pending'
                        `, [job.id], function (updateErr) {

                            if (updateErr) {

                                sqlite.run("ROLLBACK");

                                return reject(updateErr);
                            }

                            // another worker got it
                            if (this.changes === 0) {

                                sqlite.run("ROLLBACK");

                                return resolve(null);
                            }

                            sqlite.run("COMMIT", (commitErr) => {

                                if (commitErr) {
                                    return reject(commitErr);
                                }

                                job.payload =
                                    job.payload
                                        ? JSON.parse(job.payload)
                                        : {};

                                resolve(job);
                            });
                        });
                    });
                }
            );
        });
    });
}


// --------------------------------------------------

async function completeJob(id) {

    return db.execute(`
        UPDATE jobs
        SET status = 'completed',
            updated_at = datetime('now')
        WHERE id = ?
    `, [id]);
}

// --------------------------------------------------

async function failJob(id, error) {

    return db.execute(`
        UPDATE jobs
        SET status = 'failed',
            updated_at = datetime('now')
        WHERE id = ?
    `, [id]);
}

// --------------------------------------------------

module.exports = {
    claimJob,
    completeJob,
    failJob
};