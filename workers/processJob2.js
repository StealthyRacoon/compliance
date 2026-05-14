const path = require("path");
const db = require("../db/db");
const { normalizeScriptResult } = require("../core/scriptResult");

async function processJob(job, context) {

    // --------------------------------------------------
    // LOOKUP SCRIPT
    // --------------------------------------------------

    const registry = await db.get(`
        SELECT *
        FROM script_registry
        WHERE job_type = ?
          AND enabled = 1
    `, [job.type]);

    if (!registry) {
        throw new Error(`No script registered for ${job.type}`);
    }

    // --------------------------------------------------
    // LOAD SCRIPT
    // --------------------------------------------------

    const scriptPath = path.resolve(registry.script_path);
    const run = require(scriptPath);

    // --------------------------------------------------
    // EXECUTE SCRIPT
    // --------------------------------------------------

    const rawResult = await run(job, context);

    // --------------------------------------------------
    // NORMALISE OUTPUT (KEY CHANGE)
    // --------------------------------------------------

    const result = normalizeScriptResult(rawResult);

    // --------------------------------------------------
    // RETURN STANDARDISED RESULT
    // --------------------------------------------------

    return {
        jobId: job.id,
        type: job.type,
        ...result
    };
}

module.exports = {
    processJob
};