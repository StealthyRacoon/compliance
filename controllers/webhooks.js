const express = require("express");
const router = express.Router();

const { v4: uuid } = require("uuid");
const db = require("../db/db");

const { createDriveSubscription } = require("../utils/graph")


// --------------------------------------------------
// MICROSOFT VALIDATION HANDSHAKE
// --------------------------------------------------

router.post("/sharepoint", (req, res) => {

    const token = req.query.validationToken;

    if (token) {

        console.log("✅ Validation request");

        return res
            .status(200)
            .type("text/plain")
            .send(token);
    }

    console.log("🔥 Notification received");

    console.log(JSON.stringify(req.body, null, 2, new Date().now));

    return res.sendStatus(200);
});


// --------------------------------------------------
// SHAREPOINT CHANGE NOTIFICATIONS
// --------------------------------------------------
router.post("/subscribe/:driveId", async (req, res) => {
    const token = req.query.validationToken;

    try {

        const result = await createDriveSubscription(
            req.params.driveId
        );

        res.json(result);

    } catch (err) {

        console.error(err.response?.data || err);

        res.status(500).json({
            error: err.response?.data || err.message
        });
    }
});


module.exports = router;