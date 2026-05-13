const { graphGetRaw } = require("../utils/graph");
const { v4: uuid } = require("uuid");

// --------------------------------------------------
// CONFIG
// --------------------------------------------------

const CONCURRENCY = 4;

// --------------------------------------------------
// SIMPLE CONCURRENCY POOL
// --------------------------------------------------

async function runPool(items, handler) {

    const executing = new Set();
    let index = 0;

    async function next() {

        if (index >= items.length) return;

        const item = items[index++];

        const p = Promise.resolve()
            .then(() => handler(item))
            .catch(err => {
                console.error("🔥 ITEM FAILED:", err.message);
            })
            .finally(() => {
                executing.delete(p);
            });

        executing.add(p);

        if (executing.size >= CONCURRENCY) {
            await Promise.race(executing);
        }

        return next();
    }

    await next();
    await Promise.all(executing);
}

// --------------------------------------------------
// MAIN
// --------------------------------------------------

module.exports = async function run(job, { db, payload }) {

    const site_id = payload.site_id;
    const drive_id = payload.drive_id;

    const scanRunId = job.scan_run_id || uuid();

    if (!site_id || !drive_id) {
        return {
            success: false,
            error: "Missing site_id or drive_id"
        };
    }

    // --------------------------------------------------
    // LOAD CURRENT DELTA LINK FROM DB
    // --------------------------------------------------

    const driveRow = await db.get(`
        SELECT delta_link
        FROM drives
        WHERE drive_id = ?
        LIMIT 1
    `, [drive_id]);

    const existingDeltaLink =
        driveRow?.delta_link || null;

    // --------------------------------------------------
    // DETERMINE START URL
    // --------------------------------------------------

    let nextUrl =
        existingDeltaLink ||
        `https://graph.microsoft.com/v1.0/drives/${drive_id}/root/delta?$top=999`;

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🚀 scanDrive START");
    console.log("📀 Drive:", drive_id);
    console.log("🏷 Site:", site_id);
    console.log(
        existingDeltaLink
            ? "🔁 Resuming from delta link"
            : "🆕 Starting fresh full scan"
    );
    console.log("━━━━━━━━━━━━━━━━━━━━━━\n");

    let processed = 0;
    let finalDeltaLink = existingDeltaLink;

    try {

        while (nextUrl) {

            console.log("🌐 Fetch:", nextUrl);

            const data = await graphGetRaw(nextUrl);

            const items = data.value || [];

            finalDeltaLink =
                data["@odata.deltaLink"] ||
                finalDeltaLink;

            console.log("📦 Items:", items.length);

            // --------------------------------------------------
            // FILES ONLY
            // --------------------------------------------------

            const files = items.filter(i => i.file);

            // --------------------------------------------------
            // PROCESS FILES
            // --------------------------------------------------

            await runPool(files, async (item) => {

                const file_id =
                    `${site_id}:${drive_id}:${item.id}`;

                const rawData = {
                    ...item
                };

                await db.execute(`
                    INSERT INTO files (
                        file_id,
                        site_id,
                        drive_id,
                        name,
                        web_url,
                        last_modified,
                        raw_data,
                        metadata,
                        needs_enrichment,
                        status,
                        last_seen_run_id,
                        last_scanned_at
                    )
                    VALUES (
                        ?, ?, ?, ?, ?, ?, ?, NULL, 1,
                        'scanned', ?, datetime('now')
                    )

                    ON CONFLICT(file_id) DO UPDATE SET
                        name = excluded.name,
                        web_url = excluded.web_url,
                        last_modified = excluded.last_modified,
                        raw_data = excluded.raw_data,
                        needs_enrichment = 1,
                        status = excluded.status,
                        last_scanned_at = excluded.last_scanned_at
                `, [
                    file_id,
                    site_id,
                    drive_id,
                    item.name || null,
                    item.webUrl || null,
                    item.lastModifiedDateTime || null,
                    JSON.stringify(rawData),
                    scanRunId
                ]);

                processed++;
            });

            nextUrl =
                data["@odata.nextLink"] || null;
        }

        // --------------------------------------------------
        // STORE DELTA TOKEN
        // --------------------------------------------------

        if (finalDeltaLink) {

            console.log("💾 Saving delta link");

            await db.execute(`
                UPDATE drives
                SET delta_link = ?,
                    status = 'done',
                    updated_at = datetime('now')
                WHERE drive_id = ?
            `, [
                finalDeltaLink,
                drive_id
            ]);
        }

        console.log("\n✅ DELTA SCAN DONE");
        console.log("📦 Files processed:", processed);

        return {
            success: true,
            data: {
                site_id,
                drive_id,
                scanRunId,
                filesProcessed: processed,
                usedDeltaLink: !!existingDeltaLink
            }
        };

    } catch (err) {

        console.error("❌ scanDrive FAILED:", err.message);

        await db.execute(`
            UPDATE drives
            SET status = 'failed',
                updated_at = datetime('now')
            WHERE drive_id = ?
        `, [drive_id]);

        return {
            success: false,
            error: err.message
        };
    }
};