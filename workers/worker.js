const db = require("../db/db");
const path = require("path");
const { claimJob, completeJob, failJob } = require("../core/jobs");
const { finalizeScanRun } = require("../core/scanRuns");

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

            if (job.scan_run_id) {
                await finalizeScanRun(job.scan_run_id);
            }

            await db.execute(`
                UPDATE scan_runs
                SET completed_jobs = COALESCE(completed_jobs, 0) + 1
                WHERE id = ?
            `, [job.scan_run_id]);

            console.log(`✅ Job completed: ${job.id}`);

        } catch (err) {

            console.error("❌ Job error:", err.message);

            if (job?.id) {
                await failJob(job.id, err.message);
            }

            if (job?.scan_run_id) {

                await db.execute(`
                    UPDATE scan_runs
                    SET metadata = json_set(
                        COALESCE(metadata, '{}'),
                        '$.failed_jobs',
                        COALESCE(json_extract(metadata, '$.failed_jobs'), 0) + 1
                    )
                    WHERE id = ?
                `, [job.scan_run_id]);

                eventBus.emit("worker_event", {
                    type: "job_failed",
                    jobId: job?.id,
                    jobType: job?.type,
                    error: err.message,
                    workerId: process.pid,
                    scanRunId: job?.scan_run_id
                });
            }
        }
    }
}

run();