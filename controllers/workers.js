const express = require("express");
const router = express.Router();
const { v4: uuid } = require("uuid");

const db = require("../db/db");
const { spawnWorker } = require("../core/workerManager");
const { workers, setWorker } = require("../core/workerStore");

// --------------------------------------------------
// IN-MEMORY REGISTRY (source of truth for WS later)
// --------------------------------------------------

// const workers = new Map();


// --------------------------------------------------
// START WORKERS
// POST /workers/start
// body: { count, concurrency }
// --------------------------------------------------

router.post("/start", async (req, res) => {

    const count = Math.min(Math.max(parseInt(req.body?.count || 1), 1), 50);
    const concurrency = Math.min(Math.max(parseInt(req.body?.concurrency || 3), 1), 50);

    const started = [];

    for (let i = 0; i < count; i++) {

        const workerId = uuid();

        const worker = {
            id: workerId,
            status: "running",
            concurrency,
            createdAt: Date.now(),
            stats: {
                jobsProcessed: 0,
                jobsFailed: 0
            }
        };

        workers.set(workerId, worker);

        // actually start execution loop
        setWorker(workerId, worker);
        spawnWorker(worker, { db });

        started.push(worker);
    }

    res.json({
        success: true,
        workersStarted: started.length,
        workers: started
    });
});


// --------------------------------------------------
// GET ALL WORKERS
// GET /workers
// --------------------------------------------------

router.get("/", (req, res) => {

    res.json({
        workers: Array.from(workers.values())
    });
});


// --------------------------------------------------
// GET SINGLE WORKER
// GET /workers/:id
// --------------------------------------------------

router.get("/:id", (req, res) => {

    const worker = workers.get(req.params.id);

    if (!worker) {
        return res.status(404).json({ error: "Worker not found" });
    }

    res.json(worker);
});


// --------------------------------------------------
// STOP WORKER
// POST /workers/kill/:id
// --------------------------------------------------

router.post("/kill/:id", (req, res) => {

    const worker = workers.get(req.params.id);

    if (!worker) {
        return res.status(404).json({ error: "Worker not found" });
    }

    worker.status = "stopped";

    workers.set(worker.id, worker);

    res.json({
        success: true,
        workerId: worker.id,
        status: "stopped"
    });
});


// --------------------------------------------------

module.exports = {
    router,
    workers
};