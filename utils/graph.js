const axios = require("axios");
const { ConfidentialClientApplication } = require("@azure/msal-node");
const dotenv = require("dotenv");
dotenv.config();

// --------------------------------------------------
// MSAL
// --------------------------------------------------

const msalConfig = {
    auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        authority:
            `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
        clientSecret: process.env.AZURE_CLIENT_SECRET
    }
};

const cca = new ConfidentialClientApplication(msalConfig);

let cachedToken = null;
let tokenExpires = 0;

// --------------------------------------------------
// TOKEN
// --------------------------------------------------

async function getAccessToken() {

    const now = Date.now();

    if (cachedToken && tokenExpires > now + 60000) {
        return cachedToken;
    }

    const response =
        await cca.acquireTokenByClientCredential({
            scopes: ["https://graph.microsoft.com/.default"]
        });

    cachedToken = response.accessToken;
    tokenExpires = response.expiresOn.getTime();

    return cachedToken;
}

// --------------------------------------------------
// WEBHOOK TOKEN
// --------------------------------------------------

async function getWebhookAccessToken() {

    const response = await axios.post(
        `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
        new URLSearchParams({
            client_id: process.env.AZURE_CLIENT_ID,
            client_secret: process.env.AZURE_CLIENT_SECRET,
            scope: "https://graph.microsoft.com/.default",
            grant_type: "client_credentials"
        }),
        {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            }
        }
    );

    return response.data.access_token;
}



// --------------------------------------------------
// HELPERS
// --------------------------------------------------

const sleep = (ms) =>
    new Promise(r => setTimeout(r, ms));



// --------------------------------------------------
// SAFE GRAPH REQUEST
// --------------------------------------------------

async function graphRequest(fn, retries = 8) {

    for (let attempt = 0; attempt < retries; attempt++) {

        try {

            return await fn();

        } catch (err) {

            const status =
                err?.response?.status;

            // --------------------------------------------------
            // THROTTLED
            // --------------------------------------------------

            if (status === 429 || status === 503) {

                const retryAfter =
                    parseInt(
                        err?.response?.headers?.["retry-after"]
                    );

                // fallback exponential backoff
                const delay =
                    retryAfter
                        ? retryAfter * 1000
                        : Math.min(
                            1000 * Math.pow(2, attempt),
                            30000
                        );

                // jitter prevents retry storms
                const jitter =
                    Math.floor(Math.random() * 500);

                const wait =
                    delay + jitter;

                console.log(
                    `⏳ GRAPH THROTTLED (${status}) ` +
                    `retry ${attempt + 1}/${retries} ` +
                    `waiting ${wait}ms`
                );

                await sleep(wait);

                continue;
            }

            // --------------------------------------------------
            // TOKEN EXPIRED
            // --------------------------------------------------

            if (status === 401) {

                console.log("🔑 Resetting token cache");

                cachedToken = null;
                tokenExpires = 0;

                continue;
            }

            throw err;
        }
    }

    throw new Error("Graph request max retries exceeded");
}

// --------------------------------------------------
// RAW GET
// --------------------------------------------------

async function graphGetRaw(url) {

    return graphRequest(async () => {

        const token = await getAccessToken();

        const res = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        return res.data;
    });
}

// --------------------------------------------------
// POST
// --------------------------------------------------

async function graphPost(url, body = {}) {

    return graphRequest(async () => {

        const token = await getAccessToken();

        const res = await axios.post(
            url,
            body,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                }
            }
        );

        return res.data;
    });
}

// --------------------------------------------------
// PAGINATION
// --------------------------------------------------

async function graphGetAllPages(url) {

    let results = [];
    let next = url;

    while (next) {

        const data = await graphGetRaw(next);

        results.push(...(data.value || []));

        next = data["@odata.nextLink"] || null;
    }

    return results;
}

// --------------------------------------------------

module.exports = {
    graphGetRaw,
    graphPost,
    graphGetAllPages,
    getWebhookAccessToken,
};