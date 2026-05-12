const fs = require("fs");
const path = require("path");

// Ensure logs directory exists
const logDir = path.join(__dirname, "../logs");
const logFile = path.join(logDir, "app.log");

if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// --------------------------------------------------
// INTERNAL LOG WRITER
// --------------------------------------------------

function writeLog(level, message, meta = {}) {

    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        meta
    };

    const line = JSON.stringify(entry) + "\n";

    fs.appendFile(logFile, line, () => {});
}

// --------------------------------------------------
// REQUEST LOGGER MIDDLEWARE
// --------------------------------------------------

function requestLogger(req, res, next) {

    const start = Date.now();

    writeLog("info", "Request received", {
        method: req.method,
        url: req.url
    });

    res.on("finish", () => {

        writeLog("info", "Request completed", {
            method: req.method,
            url: req.url,
            status: res.statusCode,
            durationMs: Date.now() - start
        });
    });

    next();
}

// --------------------------------------------------
// OPTIONAL: expose helper for non-HTTP logs
// --------------------------------------------------

requestLogger.log = writeLog;

module.exports = requestLogger;