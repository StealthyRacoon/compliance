const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
const app = express();


app.use(express.json());

dotenv.config();

app.post("/webhooks/sharepoint", async (req, res) => {

    const token = req.query.validationToken;

    if (token) {
        return res.status(200).type("text/plain").send(token);
    }

    if (!Array.isArray(req.body?.value)) {
        console.warn("❌ Invalid payload shape");
        return res.sendStatus(400);
    }

    for (const n of req.body.value) {
        if (n.clientState !== process.env.CLIENT_SECRET) {
            console.warn("❌ Invalid clientState");
            return res.sendStatus(401);
        }
    }

    try {
        await axios.post("http://localhost:3000/webhooks/sharepoint", {
            notifications: req.body.value
        });

        return res.sendStatus(200);

    } catch (err) {
        console.error(err.message);
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