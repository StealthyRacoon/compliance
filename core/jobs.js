const db = require("../db/db");
const { v4: uuid } = require("uuid");

// --------------------------------------------------
// CREATE JOB
// --------------------------------------------------

async function createJob(type, payload = {}) {

    const id = uuid();

    await db.execute(`
        INSERT INTO jobs (
            id,
            type,
            status,
            payload
        )
        VALUES (?, ?, 'pending', ?)
    `, [
        id,
        type,
        JSON.stringify(payload)
    ]);

    return id;
}

// --------------------------------------------------
// CLAIM JOB
// --------------------------------------------------

async function claimJob() {

    const job = await db.get(`
        SELECT *
        FROM jobs
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
    `);

    if (!job) {
        return null;
    }

    await db.execute(`
        UPDATE jobs
        SET status = 'running',
            attempts = attempts + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, [job.id]);

    job.payload = JSON.parse(job.payload || "{}");

    return job;
}

// --------------------------------------------------
// COMPLETE JOB
// --------------------------------------------------

async function completeJob(jobId) {

    await db.execute(`
        UPDATE jobs
        SET status = 'done',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, [jobId]);
}

// --------------------------------------------------
// FAIL JOB
// --------------------------------------------------

async function failJob(jobId, error = null) {

    await db.execute(`
        UPDATE jobs
        SET status = 'failed',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, [jobId]);

    if (error) {
        console.error(error);
    }
}

// --------------------------------------------------
// EXPORTS
// --------------------------------------------------

module.exports = {
    createJob,
    claimJob,
    completeJob,
    failJob
};