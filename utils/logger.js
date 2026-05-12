const fs = require("fs");
const path = require("path");

const logFile = path.join(__dirname, "../logs/app.log");

function writeLog(level, message, meta = null) {
    const timestamp = new Date().toISOString();

    const entry = {
        timestamp,
        level,
        message,
        meta
    };

    fs.appendFileSync(
        logFile,
        JSON.stringify(entry) + "\n"
    );
}

function info(msg, meta) {
    writeLog("info", msg, meta);
}

function error(msg, meta) {
    writeLog("error", msg, meta);
}

function warn(msg, meta) {
    writeLog("warn", msg, meta);
}

module.exports = {
    info,
    error,
    warn
};