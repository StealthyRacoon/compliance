const { graphGetRaw } = require("../utils/graph");
const { v4: uuid } = require("uuid");

// --------------------------------------------------
// MAIN
// --------------------------------------------------

module.exports = async function run(job, { db, payload }) {

    const site_id = payload.site_id;
    const drive_id = payload.drive_id;

    if (!site_id || !drive_id) {
        return {
            success: false,
            error: "Missing site_id or drive_id"
        };
    }

    const scanRunId = job.scan_run_id || uuid();
    const createdNewRun = !job.scan_run_id;

    // --------------------------------------------------
    // CREATE SCAN RUN (ONLY ONCE)
    // --------------------------------------------------

    if (createdNewRun) {
        await db.execute(`
            INSERT INTO scan_runs (
                id,
                type,
                status,
                started_at
            )
            VALUES (?, 'scan_drive', 'running', datetime('now'))
        `, [scanRunId]);
    }

    // --------------------------------------------------
    // GET DELTA STATE
    // --------------------------------------------------

    const driveRow = await db.get(`
        SELECT delta_link
        FROM drives
        WHERE drive_id = ?
        LIMIT 1
    `, [drive_id]);

    const existingDeltaLink = driveRow?.delta_link || null;

    let nextUrl =
        existingDeltaLink ||
        `https://graph.microsoft.com/v1.0/drives/${drive_id}/root/delta?$top=999`;

    console.log("\n🚀 scanDrive START");
    console.log("Drive:", drive_id);
    console.log(existingDeltaLink ? "Resuming delta" : "Fresh scan");

    let processed = 0;
    let finalDeltaLink = existingDeltaLink;

    try {

        while (nextUrl) {

            const data = await graphGetRaw(nextUrl);

            const items = data.value || [];

            finalDeltaLink =
                data["@odata.deltaLink"] ||
                finalDeltaLink;

            const files = items.filter(i => i.file);

            for (const item of files) {

                const file_id = `${site_id}:${drive_id}:${item.id}`;

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
                // UPSERT FILE
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
                        needs_enrichment,
                        status,
                        last_seen_run_id,
                        last_scanned_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'scanned', ?, datetime('now'))
                    ON CONFLICT(file_id) DO UPDATE SET
                        name = excluded.name,
                        web_url = excluded.web_url,
                        last_modified = excluded.last_modified,
                        raw_data = excluded.raw_data,
                        needs_enrichment = 1,
                        status = 'scanned',
                        last_scanned_at = datetime('now'),
                        last_seen_run_id = excluded.last_seen_run_id
                `, [
                    file_id,
                    site_id,
                    drive_id,
                    item.name || null,
                    item.webUrl || null,
                    item.lastModifiedDateTime || null,
                    JSON.stringify(item),
                    scanRunId
                ]);

                // --------------------------------------------------
                // AUDIT LOG
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
                    item.size || null
                ]);

                processed++;
            }

            nextUrl = data["@odata.nextLink"] || null;
        }

        // --------------------------------------------------
        // STORE DELTA TOKEN
        // --------------------------------------------------

        if (finalDeltaLink) {
            await db.execute(`
                UPDATE drives
                SET delta_link = ?,
                    updated_at = datetime('now')
                WHERE drive_id = ?
            `, [
                finalDeltaLink,
                drive_id
            ]);
        }

        // --------------------------------------------------
        // COMPLETE SCAN RUN
        // --------------------------------------------------

        if (createdNewRun) {
            await db.execute(`
                UPDATE scan_runs
                SET status = 'completed',
                    completed_at = datetime('now')
                WHERE id = ?
            `, [scanRunId]);
        }

        console.log("✅ scanDrive DONE. Files:", processed);

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