const db = require("../db/db");
const path = require("path");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --------------------------------------------------
// GLOBAL CONCURRENCY POOL (GRAPH SAFETY LAYER)
// --------------------------------------------------

const GRAPH_CONCURRENCY = 4;
let activeRequests = 0;

const queue = [];

// --------------------------------------------------
// EXECUTE WITH GLOBAL CONCURRENCY CONTROL
// --------------------------------------------------

async function runWithGraphLimit(fn) {
    return new Promise((resolve, reject) => {

        queue.push({ fn, resolve, reject });
        processQueue();
    });
}

async function processQueue() {

    if (activeRequests >= GRAPH_CONCURRENCY) return;
    if (queue.length === 0) return;

    const job = queue.shift();
    activeRequests++;

    try {
        const result = await job.fn();
        job.resolve(result);
    } catch (err) {
        job.reject(err);
    } finally {
        activeRequests--;
        processQueue();
    }
}

// --------------------------------------------------
// DRIVE PROCESSOR
// --------------------------------------------------

async function processDrive(drive, scanScript) {

    console.log("📀 Drive:", drive.drive_id);

    const scriptPath = path.resolve(scanScript);
    const run = require(scriptPath);

    let nextUrl =
        drive.delta_link ||
        `https://graph.microsoft.com/v1.0/drives/${drive.drive_id}/root/delta?$top=999`;

    await run({
        drive,
        nextUrl,
        isDelta: !!drive.delta_link,
        runWithGraphLimit
    }, { db });
}

// --------------------------------------------------
// MAIN LOOP
// --------------------------------------------------

async function loop() {

    console.log("🚀 SINGLE INGESTION ENGINE STARTED");

    while (true) {

        try {

            const drives = await db.query(`
                SELECT *
                FROM drives
                WHERE status IN ('pending', 'failed')
            `);

            if (!drives.length) {
                await sleep(1000);
                continue;
            }

            console.log(`▶ Drives queued: ${drives.length}`);

            for (const drive of drives) {

                try {

                    await db.execute(`
                        UPDATE drives
                        SET status = 'running',
                            updated_at = datetime('now')
                        WHERE drive_id = ?
                    `, [drive.drive_id]);

                    await processDrive(drive, "./scripts/scanDrive");

                    await db.execute(`
                        UPDATE drives
                        SET status = 'done',
                            updated_at = datetime('now')
                        WHERE drive_id = ?
                    `, [drive.drive_id]);

                } catch (err) {

                    console.error("🔥 Drive failed:", drive.drive_id, err.message);

                    await db.execute(`
                        UPDATE drives
                        SET status = 'failed',
                            last_error = ?
                        WHERE drive_id = ?
                    `, [
                        err.message,
                        drive.drive_id
                    ]);
                }
            }

        } catch (err) {

            console.error("🔥 ENGINE CRASH:", err);
            await sleep(2000);
        }
    }
}

if (require.main === module) {
    loop();
}

module.exports = { loop };