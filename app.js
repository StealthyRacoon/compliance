const express = require("express");
const dotenv = require("dotenv");
const http = require("http");

const { createJob } = require("./core/jobs");
const scanRoutes = require("./controllers/scan");
const workerRoutes = require("./controllers/workers").router;
const { workers } = require("./controllers/workers");

const { createWorkerWS } = require("./ws/workers");


const app = express();
const server = http.createServer(app);


dotenv.config();

app.use(express.json());

const ws = createWorkerWS(server, { workers });

app.set("ws", ws.broadcast);



app.use('/scan', scanRoutes)
app.use('/workers', workerRoutes)


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

server.listen(PORT, () => {
    console.log(`API running on port ${PORT}`);
});