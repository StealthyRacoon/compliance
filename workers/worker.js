const db = require("../db/db");
const path = require("path");

const logger = require("../utils/logger");
const graph = require("../utils/graph");

const { claimJob, completeJob, failJob } = require("../core/jobs");



async function processJob(job) {

    const registry = await db.get(`
        SELECT *
        FROM script_registry
        WHERE job_type = ?
          AND enabled = 1
    `, [job.type]);

    if (!registry) {
        throw new Error(`No script registered for job type: ${job.type}`);
    }

    const scriptPath = path.resolve(registry.script_path);

    console.log("▶ Loading script:", scriptPath);

    const runScript = require(scriptPath);

    const result = await runScript(job, {
        db
    });

    return {
        jobId: job.id,
        type: job.type,
        success: result?.success ?? false,
        data: result?.data,
        error: result?.error
    };
}

async function loop() {

    while (true) {

        try {

            const job = await claimJob();

            if (!job) {
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            console.log("CLAIMED JOB:", job.id, job.type);

            let result;

            try {
                result = await processJob(job);
                console.log("✔ PROCESS RESULT:", result);

            } catch (err) {

                console.error("🔥 PROCESS JOB FAILED:", err);

                logger.error("processJob failed", {
                    jobId: job.id,
                    error: err.message,
                    stack: err.stack
                });

                await failJob(job.id, err.message);
                continue;
            }

            if (!result || result.success === false) {

                console.error("❌ JOB FAILED:", result?.error);

                logger.error("job execution failed", {
                    jobId: job.id,
                    error: result?.error
                });

                await failJob(job.id, result?.error || "Unknown failure");
                continue;
            }

            await completeJob(job.id);

            console.log("✔ JOB COMPLETED:", job.id);

        } catch (err) {

            console.error("🔥 WORKER LOOP CRASH:", err);

            logger.error("worker loop crash", {
                error: err.message,
                stack: err.stack
            });

            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

console.log("Worker started");

loop();