const { graphGetRaw, graphPost } = require("../utils/graph");
const { v4: uuid } = require("uuid");

// --------------------------------------------------
// CONFIG
// --------------------------------------------------

const CONCURRENCY = 4; // DB + processing only (NOT Graph)
const BATCH_SIZE = 10;

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let throttleDelay = 0;

async function throttle() {
    if (throttleDelay > 0) {
        console.log(`🧊 Throttling for ${throttleDelay}ms`);
        await sleep(throttleDelay);
        throttleDelay = Math.max(0, throttleDelay - 250);
    }
}

function handleGraphError(err) {
    const status = err?.response?.status || err?.status;

    if (status === 429 || status === 503) {
        throttleDelay = Math.min(throttleDelay + 2000, 30000);
        console.log(`⚠️ Graph throttle detected → increasing delay to ${throttleDelay}ms`);
    }
}

// --------------------------------------------------
// SIMPLE POOL (DB ONLY)
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
            .finally(() => executing.delete(p));

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
    const delta_link = payload.delta_link;

    const scanRunId = job.scan_run_id || uuid();

    if (!site_id || !drive_id) {
        return {
            success: false,
            error: "Missing site_id or drive_id"
        };
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🚀 scanDrive START");
    console.log("📀 Drive:", drive_id);
    console.log("🏷 Site:", site_id);
    console.log("⚡ Concurrency:", CONCURRENCY);
    console.log("━━━━━━━━━━━━━━━━━━━━━━\n");

    let nextUrl =
        delta_link ||
        `https://graph.microsoft.com/v1.0/drives/${drive_id}/root/delta?$top=999`;

    let processed = 0;
    let finalDeltaLink = null;

    try {

        while (nextUrl) {

            await throttle();

            console.log("🌐 Fetch:", nextUrl);

            let data;

            try {
                data = await graphGetRaw(nextUrl);
            } catch (err) {
                handleGraphError(err);
                throw err;
            }

            const items = data.value || [];

            finalDeltaLink = data["@odata.deltaLink"] || finalDeltaLink;

            console.log("📦 Items:", items.length);

            const files = items.filter(i => i.file);

            // --------------------------------------------------
            // STEP 1: FETCH listItem/fields (SEQUENTIAL BATCHES)
            // --------------------------------------------------

            const fieldMap = new Map();

            for (let i = 0; i < files.length; i += BATCH_SIZE) {

                const batch = files.slice(i, i + BATCH_SIZE);

                const requests = batch.map(f => ({
                    id: f.id,
                    method: "GET",
                    url: `/drives/${drive_id}/items/${f.id}/listItem/fields`
                }));

                await throttle();

                try {
                    const res = await graphPost(
                        "https://graph.microsoft.com/v1.0/$batch",
                        { requests }
                    );

                    for (const r of res.responses || []) {
                        fieldMap.set(r.id, r.body || null);
                    }

                } catch (err) {
                    handleGraphError(err);
                    console.error("⚠️ Batch failed:", err.message);
                }

                // small pacing between batches (CRITICAL)
                await sleep(250);
            }

            // --------------------------------------------------
            // STEP 2: PROCESS FILES (DB concurrency only)
            // --------------------------------------------------

            await runPool(files, async (item) => {

                const file_id = `${site_id}:${drive_id}:${item.id}`;
                const fields = fieldMap.get(item.id);

                const customMetadata = fields
                    ? {
                        department: fields.Department || null,
                        documentType: fields.DocumentType || null,
                        coupe: fields.Coupe || null,
                        keywords: fields.TaxKeyword || null
                    }
                    : null;

                const rawData = {
                    ...item,
                    sharepoint: {
                        fields,
                        customMetadata
                    }
                };

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
                        status,
                        last_seen_run_id,
                        last_scanned_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scanned', ?, datetime('now'))
                    ON CONFLICT(file_id) DO UPDATE SET
                        name = excluded.name,
                        web_url = excluded.web_url,
                        last_modified = excluded.last_modified,
                        raw_data = excluded.raw_data,
                        metadata = excluded.metadata,
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
                    JSON.stringify(customMetadata),
                    scanRunId
                ]);

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
                    VALUES (?, ?, ?, ?, ?, 'scanned', ?, ?, ?, ?, ?, datetime('now'))
                `, [
                    uuid(),
                    scanRunId,
                    site_id,
                    drive_id,
                    file_id,
                    item.name || null,
                    item.parentReference?.path || null,
                    item.file?.mimeType || null,
                    item.size || null,
                    JSON.stringify(customMetadata)
                ]);

                processed++;
            });

            nextUrl = data["@odata.nextLink"] || null;

            // --------------------------------------------------
            // CRITICAL: pacing between delta pages
            // --------------------------------------------------

            await sleep(300);
        }

        // --------------------------------------------------
        // SAVE DELTA LINK
        // --------------------------------------------------

        if (finalDeltaLink) {

            console.log("🔁 Saving delta link");

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

        console.log("\n✅ scanDrive COMPLETE");
        console.log("📦 Processed:", processed);

        return {
            success: true,
            data: {
                site_id,
                drive_id,
                scanRunId,
                filesProcessed: processed
            }
        };

    } catch (err) {

        handleGraphError(err);

        console.error("❌ scanDrive FAILED:", err.message);

        return {
            success: false,
            error: err.message
        };
    }
};