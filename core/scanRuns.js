const db = require("../db/db");

// --------------------------------------------------
// FINALIZE RUN (idempotent)
// --------------------------------------------------

async function finalizeScanRun(scanRunId) {

    const row = await db.get(`
        SELECT COUNT(*) as active
        FROM jobs
        WHERE scan_run_id = ?
          AND status IN ('pending', 'running')
    `, [scanRunId]);

    if (row.active > 0) {
        return false;
    }

    await db.execute(`
        UPDATE scan_runs
        SET status = 'completed',
            completed_at = datetime('now')
        WHERE id = ?
          AND status != 'completed'
    `, [scanRunId]);

    return true;
}

module.exports = {
    finalizeScanRun
};