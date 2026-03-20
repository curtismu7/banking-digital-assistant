/**
 * pingOneAuthorizeService.js
 *
 * Evaluates transactions against a PingOne Authorize policy (policy decision point).
 *
 * Worker credentials are read ONLY from environment variables — they are never
 * stored in runtimeSettings or returned by any admin API endpoint.
 *
 * Required env vars:
 *   PINGONE_ENVIRONMENT_ID                  — shared env ID used across the app
 *   PINGONE_AUTHORIZE_WORKER_CLIENT_ID      — client credentials app (Authorize worker)
 *   PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET  — client secret for above
 *   PINGONE_REGION                          — 'com' | 'eu' | 'ca' | 'asia' | 'com.au'
 *
 * The policy ID is passed in at call time (from runtimeSettings.get('authorizePolicyId')).
 */

const REGION_TLD_MAP = {
  com: 'com',
  eu: 'eu',
  ca: 'ca',
  asia: 'asia',
  'com.au': 'com.au',
};

function getRegionTld() {
  const r = (process.env.PINGONE_REGION || 'com').toLowerCase();
  return REGION_TLD_MAP[r] || 'com';
}

const apiBase = () => `https://api.pingone.${getRegionTld()}`;
const authBase = () => `https://auth.pingone.${getRegionTld()}`;

/**
 * Obtain a short-lived worker token via client credentials grant.
 * @returns {Promise<string>} access_token
 */
async function getWorkerToken() {
  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const clientId = process.env.PINGONE_AUTHORIZE_WORKER_CLIENT_ID;
  const clientSecret = process.env.PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET;

  if (!envId || !clientId || !clientSecret) {
    throw new Error(
      'PingOne Authorize worker credentials are not configured. ' +
      'Set PINGONE_ENVIRONMENT_ID, PINGONE_AUTHORIZE_WORKER_CLIENT_ID, and ' +
      'PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET in your environment.'
    );
  }

  const tokenUrl = `${authBase()}/${envId}/as/token`;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Worker token request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('Worker token response did not include access_token');
  }
  return data.access_token;
}

/**
 * Evaluate a transaction against the configured PingOne Authorize policy decision point.
 *
 * @param {object} params
 * @param {string} params.policyId  - PDP ID from runtimeSettings.get('authorizePolicyId')
 * @param {string} params.userId    - Subject performing the transaction
 * @param {number} params.amount    - Transaction amount
 * @param {string} params.type      - 'transfer' | 'withdrawal' | 'deposit'
 * @param {string} [params.acr]     - ACR value from the user's token (e.g. 'Multi_factor')
 * @returns {Promise<{ decision: 'PERMIT'|'DENY'|'INDETERMINATE', raw: object }>}
 */
async function evaluateTransaction({ policyId, userId, amount, type, acr }) {
  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  if (!envId) throw new Error('PINGONE_ENVIRONMENT_ID is not configured.');
  if (!policyId) throw new Error('authorizePolicyId is not configured in runtimeSettings.');

  const workerToken = await getWorkerToken();

  const url = `${apiBase()}/v1/environments/${envId}/governance/policyDecisionPoints/${policyId}/evaluate`;

  const payload = {
    context: {
      user: {
        id: userId,
        acr: acr || null,
      },
      transaction: {
        amount,
        type,
        timestamp: new Date().toISOString(),
      },
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${workerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PingOne Authorize evaluation failed (${response.status}): ${text}`);
  }

  const raw = await response.json();
  // PingOne Authorize returns { decision: 'PERMIT' | 'DENY' | 'INDETERMINATE', ... }
  const decision = raw.decision || 'INDETERMINATE';
  return { decision, raw };
}

module.exports = { evaluateTransaction };
