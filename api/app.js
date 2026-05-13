const express = require("express");
const { createJob } = require("../core/jobs");
const dotenv = require("dotenv");
dotenv.config();


const app = express();

app.use(express.json());

// --------------------------------------------------
// TEST ENDPOINT
// --------------------------------------------------

app.post("/jobs/test", async (req, res) => {

    try {

        const jobId = await createJob(
            "test",
            req.body
        );

        res.json({
            success: true,
            jobId
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.post("/discover/start", async (req, res) => {

    try {

        const jobId =
            await createJob("discover_sites");

        res.json({
            success: true,
            jobId
        });

    } catch (err) {

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


app.use((err, req, res, next) => {
    console.error(err);

    res.status(500).json({
        error: err.message || "Internal Server Error"
    });
});


// --------------------------------------------------
// START SERVER
// --------------------------------------------------

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`API running on port ${PORT}`);
});