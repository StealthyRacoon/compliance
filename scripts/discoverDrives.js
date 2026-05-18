const { graphGetAllPages } = require("../utils/graph");
const { v4: uuid } = require("uuid");

module.exports = async function run(job, { db, payload }) {

    const site_id = payload.site_id;
    const scanRunId = job.scan_run_id;

    if (!site_id) {
        return {
            success: false,
            error: "Missing site_id",
            data: null
        };
    }

    try {

        console.log("▶ Discover drives running for site:", site_id);

        const drives = await graphGetAllPages(
            `https://graph.microsoft.com/v1.0/sites/${site_id}/drives`
        );

        console.log("📀 DRIVES FOUND:", drives?.length || 0);

        // let processed = 0;

        for (const drive of drives || []) {

            try {

                // --------------------------------------------------
                // UPSERT DRIVE
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
                    site_id,
                    drive.name || null,
                    drive.webUrl || null
                ]);

                // --------------------------------------------------
                // CHECK FOR EXISTING JOB
                // --------------------------------------------------

                const existingJob = await db.get(`
                    SELECT id
                    FROM jobs
                    WHERE type = 'scan_drive'
                      AND status IN ('pending', 'running')
                      AND json_extract(payload, '$.drive_id') = ?
                    LIMIT 1
                `, [drive.id]);

                if (existingJob) continue;

                // --------------------------------------------------
                // CREATE SCAN JOB
                // --------------------------------------------------

                // await db.execute(`
                //     INSERT INTO jobs (
                //         id,
                //         type,
                //         status,
                //         payload,
                //         scan_run_id
                //     )
                //     VALUES (?, 'scan_drive', 'pending', ?, ?)
                // `, [
                //     uuid(),
                //     JSON.stringify({
                //         site_id,
                //         drive_id: drive.id,
                //         delta_link: null
                //     }),
                //     scanRunId
                // ]);

                // processed++;

            } catch (err) {

                console.error("🔥 DRIVE PROCESS FAILED:", err.message);
            }
        }

        return {
            success: true,
            data: {
                site_id,
                scanRunId,
                drivesFound: drives?.length || 0,
                // drivesProcessed: processed
            }
        };

    } catch (err) {

        console.error("🔥 SCRIPT FAILED:", err);

        return {
            success: false,
            error: err.message,
            data: { site_id }
        };
    }
};