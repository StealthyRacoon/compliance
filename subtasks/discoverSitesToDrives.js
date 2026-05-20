const db = require("../db/db");

module.exports = async function (result, context) {

    const sites = result?.data?.sites || [];

    console.log("[Task Expander] result: ", result)
    console.log("[Task Expander] context: ", context)

    for (const site of sites) {


        await db.execute(`
            INSERT INTO tasks (
                id,
                job_id,
                task_type,
                status,
                payload,
                created_at
            )
            VALUES (
                lower(hex(randomblob(16))),
                ?,
                'discover_drives',
                'pending',
                ?,
                datetime('now')
            )
        `, [
            context.task.job_id,
            JSON.stringify({
                site_id: site.id
            })
        ]);
    }
};