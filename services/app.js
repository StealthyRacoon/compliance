const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

app.post("/webhooks/sharepoint", async (req, res) => {

    const token = req.query.validationToken;

    // -----------------------------------------
    // GRAPH VALIDATION HANDSHAKE
    // -----------------------------------------
    if (token) {
        return res
            .status(200)
            .type("text/plain")
            .send(token);
    }

    const notifications = req.body?.value || [];

    try {

        await axios.post("http://localhost:3000/webhooks/sharepoint", {
            notifications
        });

        return res.sendStatus(200);

    } catch (err) {
        console.error("Forwarding failed:", err.message);
        return res.sendStatus(500);
    }
});

app.use((req, res) => {
    console.log("endpoint reached:", req.method, req.originalUrl);
    res.sendStatus(404);
});

const PORT = process.env.WEBHOOK_PORT || 3001;

app.listen(PORT, () => {
    console.log(`Webhook service running on ${PORT}`);
});

// ngrok http 3001