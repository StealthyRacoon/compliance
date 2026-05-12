const logger = require("../utils/logger");
const { graphGetAllPages } = require("../utils/graph");


module.exports = async function run(job, { db }) {

    const siteId = job.payload.siteId;

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

                processed++;

            } catch (err) {

                console.error("🔥 DRIVE INSERT FAILED:", err);

                logger.error("Drive insert failed", {
                    jobId: job.id,
                    driveId: drive?.id,
                    error: err.message,
                    stack: err.stack
                });
            }
        }

        return {
            success: true,
            data: {
                siteId,
                drivesFound: drives?.length || 0,
                drivesProcessed: processed
            }
        };

    } catch (err) {

        console.error("🔥 SCRIPT FAILED:", err);

        logger.error("discover_drives failed", {
            jobId: job.id,
            siteId,
            error: err.message,
            stack: err.stack
        });

        return {
            success: false,
            error: err.message,
            data: { siteId }
        };
    }
};