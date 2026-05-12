const { graphGetAllPages } = require("../utils/graph");

module.exports = async function run(job, { db }) {

    const sites = await graphGetAllPages(
        "https://graph.microsoft.com/v1.0/sites/getAllSites"
    );

    const filtered = (sites ?? []).filter(
        s => !s.webUrl?.includes("/personal/")
    );

    for (const site of filtered) {

        await db.execute(`
            INSERT OR REPLACE INTO sites (
                site_id,
                display_name,
                web_url
            )
            VALUES (?, ?, ?)
        `, [
            site.id,
            site.displayName,
            site.webUrl
        ]);
    }

    return {
        data: {
            sitesProcessed: filtered.length
        }
    };
};