const db = require("../db/db");
const { v4: uuid } = require("uuid");


async function runScheduler() {
    console.log("🧠 Scheduler started");

    while (true) {
        try {
            const now = new Date().toISOString();

            // -----------------------------------------
            // 1. FETCH DUE SCHEDULES
            // -----------------------------------------
            let schedules;



            schedules = await db.query(`
                SELECT *
                FROM schedules
                WHERE enabled = 1
                AND next_run_at <= ?
                `, [now]);


            if (schedules.length === 0) {
                await sleep(2000);
                continue;
            }

            for (const schedule of schedules) {

                // -----------------------------------------
                // 2. AVOID DUPLICATE JOB CREATION
                // -----------------------------------------
                const existing = await db.query(`
                    SELECT id
                    FROM jobs
                    WHERE job_definition_id = ?
                      AND status IN ('pending', 'running')
                      AND created_at >= datetime('now', '-1 minute')
                `, [schedule.job_definition_id]);

                if (existing.length > 0) {
                    continue;
                }

                const jobId = uuid();

                // -----------------------------------------
                // 3. CREATE JOB INSTANCE
                // -----------------------------------------
                await db.execute(`
                    INSERT INTO jobs (
                        id,
                        job_definition_id,
                        job_type,
                        status,
                        payload,
                        created_at
                    )
                    VALUES (?, ?, ?, 'pending', ?, ?)
                `, [
                    jobId,
                    schedule.job_definition_id,
                    schedule.name,
                    null,
                    now
                ]);

                // -----------------------------------------
                // 4. EXPAND JOB INTO TASKS
                // -----------------------------------------
                await expandJob(jobId, schedule.job_definition_id);

                // -----------------------------------------
                // 5. UPDATE SCHEDULE TIMING
                // -----------------------------------------
                const nextRun = new Date(
                    Date.now() + schedule.interval_ms
                ).toISOString();

                await db.execute(`
                    UPDATE schedules
                    SET last_run_at = ?,
                        next_run_at = ?,
                        last_status = 'triggered'
                    WHERE id = ?
                `, [
                    now,
                    nextRun,
                    schedule.id
                ]);

                console.log(`📦 Created job ${jobId} from schedule ${schedule.name}`);
            }

        } catch (err) {
            console.error("❌ Scheduler error:", err.message);
        }

        await sleep(2000);
    }
}

async function expandJob(jobId, jobDefinitionId) {

    console.log("Expanding: ", jobId)

    // -----------------------------------------
    // LOAD TASK DEFINITIONS
    // -----------------------------------------
    const taskDefs = await db.query(`
        SELECT *
        FROM job_definition_tasks
        WHERE job_definition_id = ?
        ORDER BY task_order ASC
    `, [jobDefinitionId]);

    // -----------------------------------------
    // CREATE RUNTIME TASKS
    // -----------------------------------------
    for (const def of taskDefs) {

        const taskId = uuid();

        await db.execute(`
            INSERT INTO tasks (
                id,
                job_id,
                task_definition_id,
                task_type,
                status,
                depends_on_task_id,
                created_at
            )
            VALUES (?, ?, ?, ?, 'pending', ?, ?)
        `, [
            taskId,
            jobId,
            def.id,
            def.task_type,
            def.depends_on_task_id,
            new Date().toISOString()
        ]);
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

runScheduler()