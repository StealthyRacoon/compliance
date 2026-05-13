const { graphPost } = require("../utils/graph");
const db = require("../db/db");

const BATCH_SIZE = 50;
const SLEEP_MS = 500; // prevents Graph + SQLite pressure

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function fetchFields(driveId, itemId) {

    const url =
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/listItem/fields`;

    try {
        const res = await graphPost(url, {});
        return res || null;
    } catch (err) {
        return null;
    }
}

async function processBatch(files) {

    for (const file of files) {

        try {

            const [siteId, driveId, itemId] = file.file_id.split(":");

            const fields = await fetchFields(driveId, itemId);

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
                file.file_id
            ]);

        } catch (err) {
            console.error("❌ enrichment failed:", file.file_id, err.message);
        }
    }
}

// --------------------------------------------------
// MAIN LOOP
// --------------------------------------------------

(async function run() {

    console.log("🚀 Enrichment worker started");

    let total = 0

    while (true) {

        try {

            const files = await db.query(`
                SELECT *
                FROM files
                WHERE needs_enrichment = 1
                LIMIT ?
            `, [BATCH_SIZE]);

            if (!files.length) {
                await sleep(SLEEP_MS);
                continue;
            }

            console.log(`🔍 Enriching batch: ${files.length}`);
            
            await processBatch(files);
            
            total += files.length
            console.log("Enriched so far: " + total)

        } catch (err) {
            console.error("🔥 enrichment loop error:", err.message);
            await sleep(1000);
        }
    }
})();