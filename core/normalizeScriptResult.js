function normalizeScriptResult(result) {

    // --------------------------------------------------
    // DEFAULT STRUCTURE
    // --------------------------------------------------

    const normalized = {
        success: false,
        data: null,
        errors: []
    };

    // --------------------------------------------------
    // HANDLE NULL/UNDEFINED
    // --------------------------------------------------

    if (!result) {
        normalized.errors.push({
            type: "empty_result",
            message: "Script returned no result"
        });

        return normalized;
    }

    // --------------------------------------------------
    // SUCCESS FLAG
    // --------------------------------------------------

    normalized.success =
        typeof result.success === "boolean"
            ? result.success
            : true;

    // --------------------------------------------------
    // DATA
    // --------------------------------------------------

    normalized.data =
        result.data !== undefined
            ? result.data
            : result;

    // --------------------------------------------------
    // ERRORS
    // --------------------------------------------------

    if (Array.isArray(result.errors)) {
        normalized.errors = result.errors;
    }

    return normalized;
}

module.exports = {
    normalizeScriptResult
};