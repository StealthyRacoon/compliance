const WebSocket = require("ws");
const { subscribe } = require("../core/eventBus");
const { getWorkers } = require("../core/workerStore");

function createWorkerWS(server) {

    const wss = new WebSocket.Server({
        server,
        path: "/ws/workers"
    });

    console.log("📡 /ws/workers initialized");

    wss.on("connection", (ws) => {

        ws.send(JSON.stringify({
            type: "snapshot",
            workers: Array.from(getWorkers().values())
        }));

        const unsubscribe = subscribe((event) => {
            ws.send(JSON.stringify(event));
        });

        ws.on("close", unsubscribe);
    });

    return {};
}

module.exports = { createWorkerWS };