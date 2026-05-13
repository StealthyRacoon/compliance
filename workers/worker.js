const db = require("../db/db");
const path = require("path");
const { claimJob, completeJob, failJob } = require("../core/jobs");

// --------------------------------------------------
// WORKER LOOP (NO CONCURRENCY, NO GRAPH LOGIC)
// --------------------------------------------------

async function run() {

    console.log("🚀 Worker started");

    while (true) {

        let job = null;

        try {
            job = await claimJob();

            if (!job) {
                await new Promise(r => setTimeout(r, 500));
                continue;
            }

            console.log(`📦 Job claimed: ${job.id} (${job.type})`);

            const registry = await db.get(`
                SELECT script_path
                FROM script_registry
                WHERE job_type = ?
                  AND enabled = 1
            `, [job.type]);

            if (!registry) {
                throw new Error(`No script registered for ${job.type}`);
            }

            const scriptPath = path.resolve(registry.script_path);

            console.log("▶ Running script:", scriptPath);

            const runScript = require(scriptPath);

            const result = await runScript(job, {
                db,
                payload: job.payload
            });

            if (!result || result.success === false) {
                throw new Error(result?.error || "Job failed");
            }

            await completeJob(job.id);

            console.log(`✅ Job completed: ${job.id}`);

        } catch (err) {

            console.error("❌ Job error:", err.message);

            if (job?.id) {
                await failJob(job.id, err.message);
            }
        }
    }
}

run();