const workers = new Map();

function getWorkers() {
    return workers;
}

function getWorker(id) {
    return workers.get(id);
}

function setWorker(id, data) {
    workers.set(id, data);
}

function updateWorker(id, patch) {

    const existing = workers.get(id);
    if (!existing) return;

    const updated = {
        ...existing,
        ...patch
    };

    workers.set(id, updated);

    return updated;
}

module.exports = {
    workers,
    getWorkers,
    getWorker,
    setWorker,
    updateWorker
};