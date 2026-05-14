const express = require("express");
const router = express.Router();
const { v4: uuid } = require("uuid");
const db = require("../db/db");



router.post("/start", async (req, res) => {

    const scanRunId = uuid();

    try {

        await db.execute(`
            INSERT INTO scan_runs (
                id,
                type,
                status,
                started_at
            )
            VALUES (?, 'scan', 'running', datetime('now'))
        `, [scanRunId]);

        await db.execute(`
            INSERT INTO jobs (
                id,
                type,
                status,
                payload,
                scan_run_id
            )
            VALUES (?, 'discover_sites', 'pending', ?, ?)
        `, [
            uuid(),
            JSON.stringify({ scanRunId }),
            scanRunId
        ]);

        res.json({
            success: true,
            scanRunId
        });

    } catch (err) {

        console.error("❌ start scan failed:", err.message);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});



router.get("/:id", async (req, res) => {

    const scanRunId = req.params.id;

    try {

        const run = await db.get(`
            SELECT *
            FROM scan_runs
            WHERE id = ?
        `, [scanRunId]);

        if (!run) {
            return res.status(404).json({ error: "Not found" });
        }

        const jobStats = await db.all(`
            SELECT status, COUNT(*) as count
            FROM jobs
            WHERE scan_run_id = ?
            GROUP BY status
        `, [scanRunId]);

        res.json({
            run,
            jobStats
        });

    } catch (err) {

        res.status(500).json({
            error: err.message
        });
    }
});


// --------------------------------------------------

module.exports = router;