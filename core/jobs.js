const db = require("../db/db");
const { v4: uuid } = require("uuid");

// --------------------------------------------------
// CLAIM JOB (still used only for task generation / orchestration triggers)
// --------------------------------------------------

async function claimJob() {

    const job = await db.get(`
        UPDATE jobs
        SET status = 'running',
            attempts = COALESCE(attempts, 0) + 1,
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

    job.payload = safeParse(job.payload);

    return job;
}

// --------------------------------------------------
// CREATE JOB
// --------------------------------------------------

async function createJob(type, payload = {}) {

    const jobId = uuid();
    const now = new Date().toISOString();

    await db.execute(`
        INSERT INTO jobs (
            id,
            job_definition_id,
            job_type,
            status,
            payload,
            attempts,
            created_at,
            updated_at
        )
        VALUES (?, ?, ?, 'pending', ?, 0, ?, ?)
    `, [
        jobId,
        payload.job_definition_id || null,
        type,
        JSON.stringify(payload),
        now,
        now
    ]);

    return {
        success: true,
        jobId
    };
}

// --------------------------------------------------
// JOB COMPLETION CHECKER (CORE LOGIC)
// --------------------------------------------------

async function checkJobCompletion(jobId) {

    const summary = await db.get(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status IN ('pending', 'running') THEN 1 ELSE 0 END) AS active
        FROM tasks
        WHERE job_id = ?
    `, [jobId]);

    if (!summary || summary.total === 0) return;

    // still running
    if (summary.active > 0) return;

    // failure wins
    if (summary.failed > 0) {
        await db.execute(`
            UPDATE jobs
            SET status = 'failed',
                updated_at = datetime('now')
            WHERE id = ?
        `, [jobId]);

        return;
    }

    // success
    await db.execute(`
        UPDATE jobs
        SET status = 'completed',
            updated_at = datetime('now')
        WHERE id = ?
    `, [jobId]);
}

// --------------------------------------------------
// JOB FAILURE (rare, usually not used anymore)
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
// HELPERS
// --------------------------------------------------

function safeParse(payload) {
    try {
        if (!payload) return {};
        return typeof payload === "string"
            ? JSON.parse(payload)
            : payload;
    } catch {
        return {};
    }
}

// --------------------------------------------------
// EXPORTS (FIXED)
// --------------------------------------------------

module.exports = {
    claimJob,
    createJob,
    failJob,
    checkJobCompletion
};