const { graphGetAllPages, graphPost } = require("../utils/graph");
const { v4: uuid } = require("uuid");

module.exports = async function run(job, { db }) {

    const { driveId, siteId } = job.payload;
    const scanRunId = job.scan_run_id;

    if (!driveId || !siteId) {
        return {
            success: false,
            error: "Missing driveId or siteId",
            data: null
        };
    }

    try {

        console.log("▶ Batch scanning drive:", driveId);

        // --------------------------------------------------
        // STEP 1: GET DRIVE ITEMS
        // --------------------------------------------------

        const items = await graphGetAllPages(
            `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`
        );

        console.log("FILES FOUND:", items?.length || 0);

        let processed = 0;

        // --------------------------------------------------
        // STEP 2: BUILD BATCH REQUESTS (20 per batch)
        // --------------------------------------------------

        const chunks = [];
        const size = 20;

        for (let i = 0; i < items.length; i += size) {
            chunks.push(items.slice(i, i + size));
        }

        for (const chunk of chunks) {

            // --------------------------------------------------
            // BUILD GRAPH BATCH PAYLOAD
            // --------------------------------------------------

            const batchRequests = chunk.map((item, index) => ({
                id: item.id,
                method: "GET",
                url: `/drives/${driveId}/items/${item.id}/listItem/fields`
            }));

            let batchResponse = null;

            try {

                batchResponse = await graphPost(
                    "https://graph.microsoft.com/v1.0/$batch",
                    {
                        requests: batchRequests
                    }
                );

            } catch (err) {
                console.error("Batch request failed:", err.message);
                continue;
            }

            const responses = batchResponse.responses || [];

            // --------------------------------------------------
            // STEP 3: PROCESS EACH FILE
            // --------------------------------------------------

            for (const item of chunk) {

                try {

                    const fileId = item.id;
                    const now = new Date().toISOString();

                    const fieldRes = responses.find(r => r.id === fileId);
                    const fields = fieldRes?.body || null;

                    // --------------------------------------------------
                    // SELECTED METADATA (QUERYABLE STRUCTURE)
                    // --------------------------------------------------

                    const metadata = fields
                        ? {
                            department: fields.Department || null,
                            documentType: fields.DocumentType || null,
                            coupe: fields.Coupe || null,
                            keywords: fields.TaxKeyword || null
                        }
                        : null;

                    // --------------------------------------------------
                    // UPSERT FILE
                    // --------------------------------------------------

                    await db.execute(`
                        INSERT INTO files (
                            file_id,
                            drive_id,
                            site_id,
                            name,
                            path,
                            mime_type,
                            size,
                            last_modified,
                            status,
                            last_seen_run_id,
                            last_scanned_at,
                            raw_data,
                            metadata
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(file_id) DO UPDATE SET
                            name = excluded.name,
                            path = excluded.path,
                            mime_type = excluded.mime_type,
                            size = excluded.size,
                            last_modified = excluded.last_modified,
                            status = excluded.status,
                            last_seen_run_id = excluded.last_seen_run_id,
                            last_scanned_at = excluded.last_scanned_at,
                            raw_data = excluded.raw_data,
                            metadata = excluded.metadata
                    `, [
                        fileId,
                        driveId,
                        siteId,
                        item.name || null,
                        item.parentReference?.path || null,
                        item.file?.mimeType || null,
                        item.size || null,
                        item.lastModifiedDateTime || null,
                        "scanned",
                        scanRunId,
                        now,
                        JSON.stringify(item),
                        JSON.stringify(metadata)
                    ]);

                    // --------------------------------------------------
                    // SCAN EVENT (AUDIT)
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
                            new_status,
                            metadata,
                            created_at
                        )
                        VALUES (?, ?, ?, ?, ?, 'scanned', ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        uuid(),
                        scanRunId,
                        siteId,
                        driveId,
                        fileId,
                        item.name || null,
                        item.parentReference?.path || null,
                        item.file?.mimeType || null,
                        item.size || null,
                        "scanned",
                        JSON.stringify(metadata),
                        now
                    ]);

                    processed++;

                } catch (err) {
                    console.error("🔥 FILE PROCESS FAILED:", err.message);
                }
            }
        }

        return {
            success: true,
            data: {
                scanRunId,
                driveId,
                filesFound: items?.length || 0,
                filesProcessed: processed
            }
        };

    } catch (err) {

        console.error("🔥 SCAN DRIVE FAILED:", err);

        return {
            success: false,
            error: err.message,
            data: { driveId, siteId }
        };
    }
};