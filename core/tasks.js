const db = require("../db/db");
const { v4: uuid } = require("uuid");

// --------------------------------------------------
// CLAIM TASK (SAFE + CONCURRENCY FRIENDLY)
// --------------------------------------------------

async function claimTask() {

    // console.log("[TASKS] Claiming tasks");

    const row = await db.get(`
        SELECT *
        FROM tasks
        WHERE status = 'pending'
          AND (run_after IS NULL OR run_after <= datetime('now'))
          AND attempts < max_attempts
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
    `);

    // console.log("Task picked:", row);

    if (!row) return null;

    await db.execute(`
        UPDATE tasks
        SET status = 'running',
            attempts = COALESCE(attempts, 0) + 1,
            started_at = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
    `, [row.id]);


    // console.log("[TASKS] Row: ", row.id)

    const task = await db.get(`
        SELECT *
        FROM tasks
        WHERE id = ?
    `, [row.id]);

    // console.log("[TASKS] Task: ", task);

    task.payload = safeParse(task.payload);

    

    return task;
}

// --------------------------------------------------
// COMPLETE TASK
// --------------------------------------------------

async function completeTask(taskId) {

    await db.execute(`
        UPDATE tasks
        SET status = 'completed',
            completed_at = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
    `, [taskId]);
}

// --------------------------------------------------
// FAIL TASK (WITH RETRY SUPPORT)
// --------------------------------------------------

async function failTask(taskId, error) {

    const task = await db.query(`
        SELECT attempts, max_attempts
        FROM tasks
        WHERE id = ?
    `, [taskId]);

    if (!task) return;

    const shouldRetry = task.attempts < task.max_attempts;

    await db.execute(`
        UPDATE tasks
        SET status = ?,
            last_error = ?,
            failed_at = CASE WHEN ? THEN NULL ELSE datetime('now') END,
            run_after = CASE WHEN ? THEN datetime('now', '+1 minute') ELSE NULL END,
            updated_at = datetime('now')
        WHERE id = ?
    `, [
        shouldRetry ? 'pending' : 'failed',
        error,
        shouldRetry,
        shouldRetry,
        taskId
    ]);
}

// --------------------------------------------------
// TASK CREATION (FROM JOB EXPANSION)
// --------------------------------------------------

async function createTask({
    jobId,
    taskType,
    payload = {},
    dependsOnTaskId = null,
    priority = 0,
    runAfter = null
}) {

    const taskId = uuid();
    const now = new Date().toISOString();

    await db.execute(`
        INSERT INTO tasks (
            id,
            job_id,
            type,
            status,
            priority,
            payload,
            attempts,
            max_attempts,
            depends_on_task_id,
            run_after,
            created_at,
            updated_at
        )
        VALUES (?, ?, ?, 'pending', ?, ?, 0, 5, ?, ?, ?, ?)
    `, [
        taskId,
        jobId,
        taskType,
        priority,
        JSON.stringify(payload),
        dependsOnTaskId,
        runAfter,
        now,
        now
    ]);

    return taskId;
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

module.exports = {
    claimTask,
    completeTask,
    failTask,
    createTask
};