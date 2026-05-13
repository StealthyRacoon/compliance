const db = require("../db/db");
const {sqlite} = require("../db/db");


// --------------------------------------------------

async function claimJob() {

    const job = await db.get(`
        UPDATE jobs
        SET status = 'running',
            attempts = attempts + 1,
            updated_at = datetime('now')
        WHERE id = (
            SELECT id
            FROM jobs
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 1
        )
        RETURNING *
    `);

    if (!job) return null;

    try {
        job.payload = job.payload
            ? JSON.parse(job.payload)
            : {};
    } catch {
        job.payload = {};
    }

    return job;
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