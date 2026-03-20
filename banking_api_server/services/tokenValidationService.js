/**
 * PingOne Token Validation Service
 * Validates JWTs issued by PingOne using the JWKS endpoint.
 * Replaces the previous ForgeRock/P1AIC token validation approach.
 */
const https = require('https');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Simple in-memory JWKS cache — refreshed after TTL
const jwksCache = new Map();
const JWKS_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch PingOne JWKS and cache the result.
 * @param {string} jwksUri
 * @returns {Promise<Array>} array of JWK objects
 */
async function fetchJwks(jwksUri) {
  const cached = jwksCache.get(jwksUri);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.keys;
  }

  return new Promise((resolve, reject) => {
    const url = new URL(jwksUri);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { Accept: 'application/json' },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const keys = parsed.keys || [];
          jwksCache.set(jwksUri, { keys, expiresAt: Date.now() + JWKS_TTL_MS });
          resolve(keys);
        } catch (err) {
          reject(new Error(`Failed to parse JWKS response: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('JWKS fetch timed out'));
    });
    req.end();
  });
}

/**
 * Convert a JWK (RS256) to a PEM public key string.
 * @param {object} jwk
 * @returns {string} PEM
 */
function jwkToPem(jwk) {
  // Use Node.js native key import
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  return key.export({ type: 'spki', format: 'pem' });
}

/**
 * Validate a JWT against PingOne JWKS.
 * Throws if invalid; returns the decoded payload if valid.
 *
 * @param {string} token  Raw JWT
 * @param {object} opts
 * @param {string} opts.jwksUri   e.g. https://auth.pingone.com/{envId}/as/jwks
 * @param {string} [opts.issuer]  Expected issuer (optional but recommended)
 * @param {string} [opts.audience] Expected audience (optional)
 * @returns {Promise<object>} decoded JWT payload
 */
async function validateToken(token, { jwksUri, issuer, audience } = {}) {
  // Decode header to get kid
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || !decoded.header) {
    throw new Error('Invalid JWT: cannot decode header');
  }
  const { kid, alg } = decoded.header;

  // Fetch JWKS
  const keys = await fetchJwks(jwksUri);

  // Find matching key
  let jwk;
  if (kid) {
    jwk = keys.find((k) => k.kid === kid);
  }
  if (!jwk) {
    // If no kid match, try the first RSA key
    jwk = keys.find((k) => k.kty === 'RSA');
  }
  if (!jwk) {
    throw new Error(`No matching JWKS key found for kid=${kid}`);
  }

  const pem = jwkToPem(jwk);

  // Verify options
  const verifyOptions = {
    algorithms: [alg || 'RS256'],
  };
  if (issuer) verifyOptions.issuer = issuer;
  if (audience) verifyOptions.audience = audience;

  return new Promise((resolve, reject) => {
    jwt.verify(token, pem, verifyOptions, (err, payload) => {
      if (err) reject(err);
      else resolve(payload);
    });
  });
}

module.exports = { validateToken };
