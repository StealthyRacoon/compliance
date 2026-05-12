const axios = require("axios");
const { ConfidentialClientApplication } = require("@azure/msal-node");

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
// GET ACCESS TOKEN
// --------------------------------------------------

async function getAccessToken() {

    const now = Date.now();

    if (
        cachedToken &&
        tokenExpires > now + 60000
    ) {
        return cachedToken;
    }

    const response =
        await cca.acquireTokenByClientCredential({
            scopes: ["https://graph.microsoft.com/.default"]
        });

    cachedToken = response.accessToken;

    tokenExpires =
        response.expiresOn.getTime();

    return cachedToken;
}

// --------------------------------------------------
// GRAPH REQUEST
// --------------------------------------------------

async function graphGet(url) {

    const token = await getAccessToken();

    const res = await axios.get(url, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    return res.data;
}

// --------------------------------------------------
// PAGED REQUEST
// --------------------------------------------------

async function graphGetAllPages(url) {

    let results = [];
    let next = url;

    while (next) {

        const data = await graphGet(next);

        results.push(...(data.value || []));

        next = data["@odata.nextLink"] || null;
    }

    return results;
}

module.exports = {
    graphGet,
    graphGetAllPages
};