const { graphGetRaw } = require("../utils/graph");

const cutoff = new Date("2026-01-01T00:00:00Z");

module.exports = async function run(job, { db }) {

    const { drive_id, site_id } = job.payload;

    if (!drive_id || !site_id) {
        return {
            success: false,
            error: "Missing drive_id or site_id"
        };
    }

    console.log("🚀 enrichDrive START:", drive_id);

    let nextUrl =
        `https://graph.microsoft.com/v1.0/drives/${drive_id}/root/delta?$top=999`;

    let processed = 0;
    let enriched = 0;
    let skipped = 0;

    try {

        while (nextUrl) {

            const data = await graphGetRaw(nextUrl);

            const items = data.value || [];

            for (const item of items) {

                if (!item.file) continue;

                const modified = item.lastModifiedDateTime
                    ? new Date(item.lastModifiedDateTime)
                    : null;

                const file_id = `${site_id}:${drive_id}:${item.id}`;

                // --------------------------------------------------
                // IGNORE OLD FILES
                // --------------------------------------------------
                if (modified && modified < cutoff) {

                    skipped++;

                    await db.execute(`
                        UPDATE files
                        SET needs_enrichment = 0
                        WHERE file_id = ?
                    `, [file_id]);

                    continue;
                }

                try {

                    const url =
                        `https://graph.microsoft.com/v1.0/drives/${drive_id}/items/${item.id}/listItem/fields`;

                    const fields = await graphGetRaw(url);

                    const metadata = fields
                        ? {
                            department: fields.Department || null,
                            documentType: fields.DocumentType || null,
                            coupe: fields.Coupe || null,
                            keywords: fields.TaxKeyword || null
                        }
                        : null;

                    await db.execute(`
                        UPDATE files
                        SET metadata = ?,
                            needs_enrichment = 0
                        WHERE file_id = ?
                    `, [
                        JSON.stringify(metadata),
                        file_id
                    ]);

                    enriched++;

                } catch (err) {

                    console.error(
                        "❌ enrichment failed:",
                        file_id,
                        err.message
                    );
                }

                processed++;
            }

            nextUrl = data["@odata.nextLink"] || null;
        }

        console.log("✅ enrichDrive DONE:", {
            drive_id,
            processed,
            enriched,
            skipped
        });

        return {
            success: true,
            data: {
                drive_id,
                processed,
                enriched,
                skipped
            }
        };

    } catch (err) {

        console.error("❌ enrichDrive FAILED:", err.message);

        return {
            success: false,
            error: err.message,
            drive_id
        };
    }
};