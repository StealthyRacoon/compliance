const { graphGetRaw } = require("../utils/graph");

const REQUIRED_FIELDS = [
    "Department",
    "DocumentType"
];

const CUTOFF_DATE = new Date("2026-01-01T00:00:00Z");

module.exports = async function run(job, { db }) {

    const { drive_id, site_id } = job.payload;

    if (!drive_id || !site_id) {
        return {
            success: false,
            error: "Missing drive_id or site_id"
        };
    }

    console.log("🚀 ENRICH DRIVE START:", drive_id);

    // --------------------------------------------------
    // GET FILES NEEDING ENRICHMENT
    // --------------------------------------------------

    const files = await db.query(`
        SELECT *
        FROM files
        WHERE drive_id = ?
          AND needs_enrichment = 1
    `, [drive_id]);

    console.log(`🔍 Files queued for enrichment: ${files.length}`);

    let enriched = 0;
    let compliant = 0;
    let nonCompliant = 0;
    let skipped = 0;

    // --------------------------------------------------
    // PROCESS FILES
    // --------------------------------------------------

    for (const file of files) {

        try {

            // ------------------------------------------
            // IGNORE OLD FILES
            // ------------------------------------------

            if (file.last_modified) {

                const modified =
                    new Date(file.last_modified);

                if (modified < CUTOFF_DATE) {

                    skipped++;

                    await db.execute(`
                        INSERT INTO scan_events (
                            id,
                            site_id,
                            drive_id,
                            file_id,
                            event_type,
                            old_status,
                            new_status,
                            file_name,
                            metadata
                        )
                        VALUES (
                            lower(hex(randomblob(16))),
                            ?, ?, ?,
                            'metadata_skipped',
                            ?,
                            ?,
                            ?,
                            ?
                        )
                    `, [
                        site_id,
                        drive_id,
                        file.file_id,
                        file.status,
                        file.status,
                        file.name,
                        JSON.stringify({
                            reason: "before_cutoff",
                            cutoff: CUTOFF_DATE.toISOString()
                        })
                    ]);

                    continue;
                }
            }

            // ------------------------------------------
            // EXTRACT ITEM ID
            // ------------------------------------------

            const [, , itemId] =
                file.file_id.split(":");

            // ------------------------------------------
            // FETCH SHAREPOINT FIELDS
            // ------------------------------------------

            const fieldsUrl =
                `https://graph.microsoft.com/v1.0/drives/${drive_id}/items/${itemId}/listItem/fields`;

            let fields = null;

            try {
                fields = await graphGetRaw(fieldsUrl);
            } catch (err) {

                await db.execute(`
                    INSERT INTO scan_events (
                        id,
                        site_id,
                        drive_id,
                        file_id,
                        event_type,
                        old_status,
                        new_status,
                        file_name,
                        metadata
                    )
                    VALUES (
                        lower(hex(randomblob(16))),
                        ?, ?, ?,
                        'metadata_fetch_failed',
                        ?,
                        ?,
                        ?,
                        ?
                    )
                `, [
                    site_id,
                    drive_id,
                    file.file_id,
                    file.status,
                    file.status,
                    file.name,
                    JSON.stringify({
                        error: err.message
                    })
                ]);

                continue;
            }

            // ------------------------------------------
            // BUILD METADATA SNAPSHOT
            // ------------------------------------------

            const metadata = {
                department: fields?.Department || null,
                documentType: fields?.DocumentType || null,
                coupe: fields?.Coupe || null,
                keywords: fields?.TaxKeyword || null
            };

            // ------------------------------------------
            // COMPLIANCE CHECK
            // ------------------------------------------

            const missingFields = [];

            for (const field of REQUIRED_FIELDS) {

                const value = fields?.[field];

                if (
                    value === null ||
                    value === undefined ||
                    value === ""
                ) {
                    missingFields.push(field);
                }
            }

            const isCompliant =
                missingFields.length === 0;

            const oldStatus =
                file.status || "unknown";

            const newStatus =
                isCompliant
                    ? "compliant"
                    : "non_compliant";

            // ------------------------------------------
            // UPDATE FILE SNAPSHOT
            // ------------------------------------------

            await db.execute(`
                UPDATE files
                SET metadata = ?,
                    status = ?,
                    needs_enrichment = 0,
                    last_scanned_at = datetime('now')
                WHERE file_id = ?
            `, [
                JSON.stringify({
                    fields,
                    extracted: metadata
                }),
                newStatus,
                file.file_id
            ]);

            // ------------------------------------------
            // WRITE AUDIT EVENT
            // ------------------------------------------

            await db.execute(`
                INSERT INTO scan_events (
                    id,
                    site_id,
                    drive_id,
                    file_id,
                    event_type,
                    old_status,
                    new_status,
                    file_name,
                    metadata
                )
                VALUES (
                    lower(hex(randomblob(16))),
                    ?, ?, ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?
                )
            `, [
                site_id,
                drive_id,
                file.file_id,

                isCompliant
                    ? "metadata_compliant"
                    : "metadata_non_compliant",

                oldStatus,
                newStatus,
                file.name,

                JSON.stringify({
                    missingFields,
                    metadata,
                    checkedAt: new Date().toISOString()
                })
            ]);

            enriched++;

            if (isCompliant) {
                compliant++;
            } else {
                nonCompliant++;
            }

        } catch (err) {

            console.error(
                "❌ ENRICH FAILED:",
                file.file_id,
                err.message
            );

            await db.execute(`
                INSERT INTO scan_events (
                    id,
                    site_id,
                    drive_id,
                    file_id,
                    event_type,
                    old_status,
                    new_status,
                    file_name,
                    metadata
                )
                VALUES (
                    lower(hex(randomblob(16))),
                    ?, ?, ?,
                    'metadata_processing_failed',
                    ?,
                    ?,
                    ?,
                    ?
                )
            `, [
                site_id,
                drive_id,
                file.file_id,
                file.status,
                file.status,
                file.name,
                JSON.stringify({
                    error: err.message
                })
            ]);
        }
    }

    console.log(`
        ✅ ENRICHMENT COMPLETE
        Drive: ${drive_id}
        Enriched: ${enriched}
        Compliant: ${compliant}
        Non-compliant: ${nonCompliant}
        Skipped: ${skipped}
    `);

    return {
        success: true,
        data: {
            drive_id,
            enriched,
            compliant,
            nonCompliant,
            skipped
        }
    };
};