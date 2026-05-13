const { v4: uuid } = require("uuid");
const { graphGetAllPages } = require("../utils/graph");

module.exports = async function run(job, { db }) {

    // --------------------------------------------------
    // START SCAN RUN
    // --------------------------------------------------

    const runId = uuid();

    await db.execute(`
        INSERT INTO scan_runs (
            id,
            type,
            status
        )
        VALUES (?, 'full_scan', 'running')
    `, [runId]);

    // --------------------------------------------------
    // FETCH SITES
    // --------------------------------------------------

    const raw = await graphGetAllPages(
        "https://graph.microsoft.com/v1.0/sites/getAllSites"
    );

    const sites = Array.isArray(raw)
        ? raw
        : (raw?.value ?? []);

    const filtered = sites.filter(
        s => !s.webUrl?.includes("/personal/")
    );

    let jobsCreated = 0;

    // --------------------------------------------------
    // PROCESS SITES
    // --------------------------------------------------

    for (const site of filtered) {

        // UPSERT SITE (current state only)
        await db.execute(`
            INSERT OR REPLACE INTO sites (
                site_id,
                display_name,
                web_url
            )
            VALUES (?, ?, ?)
        `, [
            site.id,
            site.displayName || null,
            site.webUrl || null
        ]);

        // CHECK FOR EXISTING DISCOVER_DRIVES JOB
        const existingJob = await db.get(`
            SELECT id
            FROM jobs
            WHERE type = 'discover_drives'
              AND status IN ('pending', 'running')
              AND json_extract(payload, '$.siteId') = ?
            LIMIT 1
        `, [site.id]);

        if (existingJob) continue;

        // CREATE DISCOVER_DRIVES JOB (linked to scan run)
        await db.execute(`
            INSERT INTO jobs (
                id,
                type,
                status,
                payload,
                scan_run_id
            )
            VALUES (?, 'discover_drives', 'pending', ?, ?)
        `, [
            uuid(),
            JSON.stringify({
                site_id: site.id
            }),
            runId
        ]);

        jobsCreated++;
    }

    // --------------------------------------------------
    // RESULT
    // --------------------------------------------------

    return {
        success: true,
        data: {
            scanRunId: runId,
            sitesProcessed: filtered.length,
            discoverDriveJobsCreated: jobsCreated
        }
    };
};