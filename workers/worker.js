const db = require("../db/db");
const path = require("path");
const eventBus = require("../core/eventBus");

const {
    claimTask,
    completeTask,
    failTask
} = require("../core/tasks");

// --------------------------------------------------
// WORKER LOOP (TASK-LEVEL EXECUTION)
// --------------------------------------------------

async function run() {

    console.log("[WORKER] 🚀 Task worker started");

    while (true) {

        let task = null;

        try {

            // -----------------------------------------
            // CLAIM TASK
            // -----------------------------------------
            task = await claimTask();

            if (!task) {
                await sleep(500);
                continue;
            }


            console.log(`[WORKER] 📦 Task claimed: ${task.id} (${task.task_type})`);

            // -----------------------------------------
            // RESOLVE SCRIPT FROM TASK TYPE
            // -----------------------------------------
            const registry = await db.query(`
                SELECT script_path
                FROM script_registry
                WHERE job_type = ?
                  AND enabled = 1
            `, [task.task_type]);


            if (!registry) {
                throw new Error(`No script registered for task type ${task.task_type}`);
            }

            const scriptPath = path.resolve(registry[0].script_path);

            console.log("[WORKER] ▶ Running script:", scriptPath);

            const runScript = require(scriptPath);

            // -----------------------------------------
            // EXECUTE TASK
            // -----------------------------------------
            const result = await runScript(task, {
                db,
                payload: safeParse(task.payload)
            });

            if (!result || result.success === false) {
                throw new Error(result?.error || "Task failed");
            }

            // -----------------------------------------
            // COMPLETE TASK
            // -----------------------------------------
            await completeTask(task.id);

            console.log(`[WORKER] ✅ Task completed: ${task.id}`);

            const subtasks = await db.query(`
                SELECT *
                FROM subtasks
                WHERE parent_task_type = ?
                AND enabled = 1
                ORDER BY task_order ASC
            `, [task.task_type]);

            console.log("Trying subtask: ", subtasks)

            for (const subtask of subtasks) {

                const runSubtask = require(
                    path.resolve(subtask.script_path)
                );

                await runSubtask(result, {
                    db,
                    task
                });
            }

        } catch (err) {

            console.error("[WORKER] ❌ Task error:", err.message);

            if (task?.id) {
                await failTask(task.id, err.message);
            }

            eventBus.emit("worker_event", {
                type: "task_failed",
                taskId: task?.id,
                taskType: task?.type,
                error: err.message,
                workerId: process.pid,
                jobId: task?.job_id
            });
        }
    }
}

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function safeParse(payload) {
    try {
        if (!payload) return null;
        return typeof payload === "string"
            ? JSON.parse(payload)
            : payload;
    } catch {
        return payload;
    }
}

// --------------------------------------------------
// START WORKER
// --------------------------------------------------



run();