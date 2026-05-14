const { claimJob, completeJob, failJob } = require("./jobs");
const path = require("path");

const { updateWorker } = require("./workerStore");
const { emit } = require("./eventBus");

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function spawnWorker(worker, { db }) {

    updateWorker(worker.id, worker);

    emit({
        type: "worker:start",
        worker
    });

    while (worker.status === "running") {

        let job = null;

        try {

            job = await claimJob();

            if (!job) {
                await sleep(300);
                continue;
            }

            updateWorker(worker.id, {
                currentJob: job.id
            });

            emit({
                type: "job:claimed",
                workerId: worker.id,
                jobId: job.id,
                jobType: job.type
            });

            const registry = await db.get(`
                SELECT script_path
                FROM script_registry
                WHERE job_type = ?
                  AND enabled = 1
            `, [job.type]);

            if (!registry) {
                throw new Error(`No script for ${job.type}`);
            }

            const runScript = require(path.resolve(registry.script_path));

            const result = await runScript(job, { db, payload: job.payload });

            if (!result?.success) {
                throw new Error(result?.error || "Job failed");
            }

            await completeJob(job.id);

            updateWorker(worker.id, {
                stats: {
                    ...worker.stats,
                    jobsProcessed: (worker.stats.jobsProcessed || 0) + 1
                }
            });

            emit({
                type: "job:completed",
                workerId: worker.id,
                jobId: job.id
            });

            emit({
                type: "worker:stats",
                workerId: worker.id,
                stats: worker.stats
            });

        } catch (err) {

            if (job?.id) {
                await failJob(job.id, err.message);

                emit({
                    type: "job:failed",
                    workerId: worker.id,
                    jobId: job.id,
                    error: err.message
                });
            }

            updateWorker(worker.id, {
                lastError: err.message
            });

            emit({
                type: "worker:error",
                workerId: worker.id,
                error: err.message
            });

            console.error(`❌ Worker ${worker.id}:`, err.message);
        }
    }

    emit({
        type: "worker:stopped",
        workerId: worker.id
    });
}

module.exports = {
    spawnWorker
};