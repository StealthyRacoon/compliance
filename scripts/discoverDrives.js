const { graphGetAllPages } = require("../utils/graph");
const { v4: uuid } = require("uuid");

module.exports = async function run(job, { db }) {

    const siteId = job.payload.siteId;
    const scanRunId = job.scan_run_id;

    if (!siteId) {
        return {
            success: false,
            error: "Missing siteId",
            data: null
        };
    }

    try {

        console.log("▶ Discover drives running for site:", siteId);

        const drives = await graphGetAllPages(
            `https://graph.microsoft.com/v1.0/sites/${siteId}/drives`
        );

        console.log("DRIVES FOUND:", drives?.length || 0);

        let processed = 0;

        for (const drive of drives || []) {

            try {

                // --------------------------------------------------
                // UPSERT DRIVE (current snapshot only)
                // --------------------------------------------------

                await db.execute(`
                    INSERT INTO drives (
                        drive_id,
                        site_id,
                        drive_name,
                        web_url,
                        status,
                        delta_link
                    )
                    VALUES (?, ?, ?, ?, 'pending', NULL)
                    ON CONFLICT(drive_id) DO UPDATE SET
                        drive_name = excluded.drive_name,
                        web_url = excluded.web_url
                `, [
                    drive.id,
                    siteId,
                    drive.name || null,
                    drive.webUrl || null
                ]);

                // --------------------------------------------------
                // CHECK FOR EXISTING SCAN JOB
                // --------------------------------------------------

                const existingJob = await db.get(`
                    SELECT id
                    FROM jobs
                    WHERE type = 'scan_drive'
                      AND status IN ('pending', 'running')
                      AND json_extract(payload, '$.driveId') = ?
                    LIMIT 1
                `, [drive.id]);

                if (existingJob) continue;

                // --------------------------------------------------
                // CREATE SCAN_DRIVE JOB (linked to scan run)
                // --------------------------------------------------

                await db.execute(`
                    INSERT INTO jobs (
                        id,
                        type,
                        status,
                        payload,
                        scan_run_id
                    )
                    VALUES (?, 'scan_drive', 'pending', ?, ?)
                `, [
                    uuid(),
                    JSON.stringify({
                        siteId,
                        driveId: drive.id
                    }),
                    scanRunId
                ]);

                processed++;

            } catch (err) {
                console.error("🔥 DRIVE PROCESS FAILED:", err);
            }
        }

        return {
            success: true,
            data: {
                siteId,
                scanRunId,
                drivesFound: drives?.length || 0,
                drivesProcessed: processed
            }
        };

    } catch (err) {

        console.error("🔥 SCRIPT FAILED:", err);

        return {
            success: false,
            error: err.message,
            data: { siteId }
        };
    }
};