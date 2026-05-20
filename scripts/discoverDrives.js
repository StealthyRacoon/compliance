const { graphGetAllPages } = require("../utils/graph");

// --------------------------------------------------
// MAIN
// --------------------------------------------------

module.exports = async function run(task, { db, payload }) {

    const site_id = payload.site_id;

    console.log("Payload: ", payload)

    if (!site_id) {
        return {
            success: false,
            error: "Missing site_id"
        };
    }

    try {

        console.log("▶ Discover drives running for site:", site_id);

        const drives = await graphGetAllPages(
            `https://graph.microsoft.com/v1.0/sites/${site_id}/drives`
        );

        console.log("📀 DRIVES FOUND:", drives?.length || 0);

        // --------------------------------------------------
        // UPSERT DRIVES
        // --------------------------------------------------

        for (const drive of drives || []) {

            try {

                if (drive.webUrl.includes("/PreservationHoldLibrary")) {
                    continue;
                }

                await db.execute(`
                    INSERT INTO drives (
                        drive_id,
                        site_id,
                        drive_name,
                        web_url,
                        status,
                        delta_link,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        ?, ?, ?, ?, 'pending', NULL,
                        datetime('now'),
                        datetime('now')
                    )
                    ON CONFLICT(drive_id) DO UPDATE SET
                        drive_name = excluded.drive_name,
                        web_url = excluded.web_url,
                        updated_at = datetime('now')
                `, [
                    drive.id,
                    site_id,
                    drive.name || null,
                    drive.webUrl || null
                ]);


            } catch (err) {

                console.log(`INSERT INTO drives (
                        drive_id,
                        site_id,
                        drive_name,
                        web_url,
                        status,
                        delta_link,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        ?, ?, ?, ?, 'pending', NULL,
                        datetime('now'),
                        datetime('now')
                    )
                    ON CONFLICT(drive_id) DO UPDATE SET
                        drive_name = excluded.drive_name,
                        web_url = excluded.web_url,
                        updated_at = datetime('now')
                `, [
                    drive.id,
                    site_id,
                    drive.name || null,
                    drive.webUrl || null
                ])

                if (err.response?.status === 423) {

                    await db.execute(`
                        UPDATE tasks
                        SET status = 'pending',
                            run_after = datetime('now', '+5 minutes'),
                            updated_at = datetime('now'),
                            last_error = ?
                        WHERE id = ?
                    `, [
                        err.message,
                        task.id
                    ]);

                    continue;
                }

                console.error(
                    "🔥 DRIVE UPSERT FAILED:",
                    drive.id,
                    err.message
                );
            }
        }

        // --------------------------------------------------
        // RETURN DRIVES FOR SUBTASK EXPANSION
        // --------------------------------------------------

        return {
            success: true,
            data: {
                site_id,
                drivesFound: drives?.length || 0,
                drives: (drives || []).map(drive => ({
                    drive_id: drive.id,
                    site_id,
                    drive_name: drive.name || null
                }))
            }
        };

    } catch (err) {

        console.error("🔥 SCRIPT FAILED:", err.message);

        return {
            success: false,
            error: err.message,
            data: {
                site_id
            }
        };
    }
};