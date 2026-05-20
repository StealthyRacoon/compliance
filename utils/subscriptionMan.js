const db = require("../db/db");
const axios = require("axios");
const { getAccessToken } = require("../utils/graphAuth");

const cache = new Map();

const RENEW_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_TTL_SECONDS = 60 * 60; // Graph max (varies per resource type)

// --------------------------------------------------
// LOAD CACHE
// --------------------------------------------------

async function loadActiveSubscriptions() {
    const rows = await db.query(`
        SELECT * FROM drives
        WHERE subscription_id IS NOT NULL
    `);

    for (const r of rows) {
        cache.set(r.drive_id, r);
    }

    return cache;
}

// --------------------------------------------------
// CREATE SUBSCRIPTION
// --------------------------------------------------

async function createDriveSubscription(driveId) {

    const token = await getAccessToken();

    const expiration = new Date(
        Date.now() + DEFAULT_TTL_SECONDS * 1000
    ).toISOString();

    const response = await axios.post(
        "https://graph.microsoft.com/v1.0/subscriptions",
        {
            changeType: "updated",
            notificationUrl: `${process.env.PUBLIC_WEBHOOK_URL}/webhooks/sharepoint`,
            resource: `/drives/${driveId}/root`,
            expirationDateTime: expiration,
            clientState: process.env.MS_CLIENT_STATE
        },
        {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        }
    );

    const sub = response.data;

    await db.execute(`
        UPDATE drives
        SET subscription_id = ?,
            subscription_expires_at = ?,
            subscription_status = 'active',
            updated_at = CURRENT_TIMESTAMP
        WHERE drive_id = ?
    `, [
        sub.id,
        sub.expirationDateTime,
        driveId
    ]);

    cache.set(driveId, {
        drive_id: driveId,
        subscription_id: sub.id,
        subscription_expires_at: sub.expirationDateTime,
        subscription_status: "active"
    });

    return sub;
}

// --------------------------------------------------
// DELETE SUBSCRIPTION
// --------------------------------------------------

async function deleteDriveSubscription(driveId) {

    const drive = await db.get(
        "SELECT * FROM drives WHERE drive_id = ?",
        [driveId]
    );

    if (!drive?.subscription_id) return;

    const token = await getAccessToken();

    try {
        await axios.delete(
            `https://graph.microsoft.com/v1.0/subscriptions/${drive.subscription_id}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );
    } catch (err) {
        console.warn("Graph delete failed (continuing):", err.message);
    }

    await db.execute(`
        UPDATE drives
        SET subscription_id = NULL,
            subscription_expires_at = NULL,
            subscription_status = 'deleted',
            updated_at = CURRENT_TIMESTAMP
        WHERE drive_id = ?
    `, [driveId]);

    cache.delete(driveId);
}

// --------------------------------------------------
// ENSURE SUBSCRIPTION EXISTS
// --------------------------------------------------

async function ensureSubscription(driveId) {

    const drive = await db.get(
        "SELECT * FROM drives WHERE drive_id = ?",
        [driveId]
    );

    if (
        drive?.subscription_id &&
        drive.subscription_expires_at &&
        new Date(drive.subscription_expires_at) > new Date(Date.now() + RENEW_WINDOW_MS)
    ) {
        return drive.subscription_id;
    }

    const sub = await createDriveSubscription(driveId);
    return sub.id;
}

// --------------------------------------------------
// REFRESH LOOP
// --------------------------------------------------

async function refreshLoop() {

    setInterval(async () => {

        try {
            const now = Date.now();

            const rows = await db.query(`
                SELECT * FROM drives
                WHERE subscription_expires_at IS NOT NULL
            `);

            for (const d of rows) {

                const expires = new Date(d.subscription_expires_at).getTime();

                if (expires - now < RENEW_WINDOW_MS) {
                    await ensureSubscription(d.drive_id);
                }
            }

        } catch (err) {
            console.error("❌ subscription refresh error:", err.message);
        }

    }, 15 * 60 * 1000);
}

// --------------------------------------------------
// EXPORTS
// --------------------------------------------------

module.exports = {
    loadActiveSubscriptions,
    createDriveSubscription,
    deleteDriveSubscription,
    ensureSubscription,
    refreshLoop,
    cache
};