const listeners = new Set();

function emit(event) {
    for (const fn of listeners) {
        fn(event);
    }
}

function subscribe(fn) {
    listeners.add(fn);

    return () => listeners.delete(fn);
}

module.exports = {
    emit,
    subscribe
};