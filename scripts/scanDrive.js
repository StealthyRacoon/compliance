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
    const createdNewRun = !job.scan_run_id;

    if (createdNewRun) {

        await db.execute(`
        INSERT INTO scan_runs (
                id,
                type,
                status
            )
            VALUES (
                ?,
                'scan_drive',
                'running'
            )
        `, [scanRunId]);
    }

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

                const file_id = `${site_id}:${drive_id}:${item.id}`;

                const rawData = { ...item };

                // --------------------------------------------------
                // CHECK EXISTING FILE (for event classification)
                // --------------------------------------------------

                const existing = await db.get(`
                    SELECT file_id
                    FROM files
                    WHERE file_id = ?
                    LIMIT 1
                `, [file_id]);

                const eventType = existing
                    ? "file_updated"
                    : "file_discovered";

                // --------------------------------------------------
                // UPSERT FILE STATE
                // --------------------------------------------------

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

                // --------------------------------------------------
                // SCAN EVENT (FULL HISTORY)
                // --------------------------------------------------

                await db.execute(`
                    INSERT INTO scan_events (
                        id,
                        scan_run_id,
                        site_id,
                        drive_id,
                        file_id,
                        event_type,
                        file_name,
                        file_path,
                        mime_type,
                        size,
                        metadata,
                        created_at
                    )
                    VALUES (
                        lower(hex(randomblob(16))),
                        ?, ?, ?, ?,
                        ?,
                        ?,
                        ?,
                        ?,
                        ?,
                        ?,
                        datetime('now')
                    )
                `, [
                    scanRunId,
                    site_id,
                    drive_id,
                    file_id,

                    eventType,

                    item.name || null,
                    item.parentReference?.path || null,
                    item.file?.mimeType || null,
                    item.size || null,

                    JSON.stringify({
                        webUrl: item.webUrl || null,
                        lastModified: item.lastModifiedDateTime || null
                    })
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

        if (createdNewRun) {

            await db.execute(`
        UPDATE scan_runs
        SET status = 'completed',
            completed_at = datetime('now')
        WHERE id = ?
    `, [scanRunId]);
        }


        // --------------------------------------------------
        // CREATE ENRICHMENT JOB
        // --------------------------------------------------

        if (processed > 0) {

            const existingEnrichJob = await db.get(`
                SELECT id
                FROM jobs
                WHERE type = 'enrich_drive'
                AND status IN ('pending', 'running')
                AND json_extract(payload, '$.drive_id') = ?
                LIMIT 1
            `, [drive_id]);

            if (!existingEnrichJob) {

                const enrichJobId = uuid();

                await db.execute(`
                    INSERT INTO jobs (
                        id,
                        type,
                        status,
                        payload,
                        scan_run_id,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        ?,
                        'enrich_drive',
                        'pending',
                        ?,
                        ?,
                        datetime('now'),
                        datetime('now')
                    )
                `, [
                    enrichJobId,
                    JSON.stringify({
                        site_id,
                        drive_id
                    }),
                    scanRunId
                ]);

                console.log(
                    "📦 Enrichment job queued:",
                    enrichJobId
                );

            } else {

                console.log(
                    "⏭ Enrichment job already exists for drive:",
                    drive_id
                );
            }
        }

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