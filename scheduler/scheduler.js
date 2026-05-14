const { createJob } = require("../core/jobs");
const db = require("../db/db");
const { v4: uuid } = require("uuid");

// --------------------------------------------------
// CHECK IF SCAN RUN IS DONE
// --------------------------------------------------

async function isRunComplete(scanRunId) {

    const row = await db.get(`
        SELECT COUNT(*) as active
        FROM jobs
        WHERE scan_run_id = ?
          AND status IN ('pending', 'running')
    `, [scanRunId]);

    return row.active === 0;
}

// --------------------------------------------------
// SCHEDULER LOOP
// --------------------------------------------------

async function loop() {

    while (true) {

        const scanRunId = uuid();
        const startTime = Date.now();

        try {

            console.log("\n🚀 NEW SCAN CYCLE START");
            console.log("🆔 scanRunId:", scanRunId);

            // --------------------------------------------------
            // CREATE SCAN RUN
            // --------------------------------------------------

            await db.execute(`
                INSERT INTO scan_runs (
                    id,
                    type,
                    status,
                    started_at
                )
                VALUES (
                    ?, 'full_cycle', 'running', datetime('now')
                )
            `, [scanRunId]);

            // --------------------------------------------------
            // START PIPELINE
            // --------------------------------------------------

            await createJob("discover_sites", {
                scan_run_id: scanRunId
            });

            // --------------------------------------------------
            // WAIT FOR COMPLETION
            // --------------------------------------------------

            while (true) {

                const done = await isRunComplete(scanRunId);

                if (done) break;

                console.log("⏳ Waiting for pipeline...");
                await new Promise(r => setTimeout(r, 5000));
            }

            // --------------------------------------------------
            // COMPLETE SCAN RUN
            // --------------------------------------------------

            const duration = Date.now() - startTime;

            await db.execute(`
                UPDATE scan_runs
                SET status = 'completed',
                    completed_at = datetime('now')
                WHERE id = ?
            `, [scanRunId]);

            console.log("✅ SCAN CYCLE COMPLETE");
            console.log("⏱ Duration:", duration, "ms");

        } catch (err) {

            console.error("❌ Scheduler error:", err.message);

            await db.execute(`
                UPDATE scan_runs
                SET status = 'failed',
                    completed_at = datetime('now')
                WHERE id = ?
            `, [scanRunId]);
        }

        // --------------------------------------------------
        // SMALL COOL-DOWN BEFORE NEXT CYCLE
        // --------------------------------------------------

        await new Promise(r => setTimeout(r, 5000));
    }
}

// --------------------------------------------------
// START
// --------------------------------------------------

console.log("🧠 Cycle Scheduler started");
loop();