const db = require("../db/db");
const { sqlite } = require("../db/db");
const { v4: uuid } = require("uuid");

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

async function failJob(jobId, error) {

    await db.execute(`
        UPDATE jobs
        SET status = 'failed',
            last_error = ?,
            failed_at = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
    `, [error, jobId]);
}

// --------------------------------------------------

async function createJob(type, payload = {}, options = {}) {

    const jobId = uuid();

    const now = new Date().toISOString();

    if (payload.scan_run_id) {
        await db.execute(`
            UPDATE scan_runs
            SET total_jobs = COALESCE(total_jobs, 0) + 1
            WHERE id = ?
        `, [payload.scan_run_id]);
    }

    // --------------------------------------------------
    // OPTIONAL DEDUPLICATION (important for scan/enrich)
    // --------------------------------------------------

    if (options.uniqueKey) {

        const existing = await db.get(`
            SELECT id
            FROM jobs
            WHERE type = ?
              AND status IN ('pending', 'running')
              AND json_extract(payload, ?) = ?
            LIMIT 1
        `, [
            type,
            options.uniqueKey.path,
            options.uniqueKey.value
        ]);

        if (existing) {
            return {
                success: true,
                skipped: true,
                jobId: existing.id
            };
        }
    }

    // --------------------------------------------------
    // INSERT JOB
    // --------------------------------------------------

    await db.execute(`
        INSERT INTO jobs (
            id,
            type,
            status,
            payload,
            attempts,
            created_at,
            updated_at,
            scan_run_id
        )
        VALUES (
            ?, ?, 'pending', ?, 0, ?, ?, ?
        )
    `, [
        jobId,
        type,
        JSON.stringify(payload),
        now,
        now,
        payload.scan_run_id || null
    ]);

    return {
        success: true,
        jobId
    };
}


module.exports = {
    claimJob,
    completeJob,
    failJob,
    createJob
};