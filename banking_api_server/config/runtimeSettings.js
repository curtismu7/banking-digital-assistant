/**
 * runtimeSettings.js
 *
 * In-memory store for settings that can be changed at runtime via the admin UI
 * without restarting the server or editing .env files.
 *
 * Seeded from environment variables on startup. All writes are in-memory only
 * (survive for the lifetime of the process). Add persistence (file/DB) here
 * if you need settings to survive restarts.
 */

const settings = {
  // Step-up MFA
  stepUpAmountThreshold: parseFloat(process.env.STEP_UP_AMOUNT_THRESHOLD) || 250,
  stepUpAcrValue: process.env.STEP_UP_ACR_VALUE || 'Multi_factor',
  stepUpEnabled: true,

  // Which transaction types require step-up
  stepUpTransactionTypes: ['transfer', 'withdrawal'],

  // Future: PingOne Authorize integration
  authorizeEnabled: false,
  authorizePolicyId: process.env.PINGONE_AUTHORIZE_POLICY_ID || '',
};

// Change history kept in-memory for the admin UI audit trail
const changeHistory = [];

function get(key) {
  return settings[key];
}

function getAll() {
  return { ...settings };
}

/**
 * Update one or more settings.
 * @param {object} updates  - Partial settings object
 * @param {string} changedBy - Identity of the admin making the change
 */
function update(updates, changedBy = 'unknown') {
  const allowedKeys = new Set(Object.keys(settings));
  const applied = {};

  for (const [key, value] of Object.entries(updates)) {
    if (!allowedKeys.has(key)) continue; // Ignore unknown keys

    // Type-coerce numeric fields
    if (key === 'stepUpAmountThreshold') {
      const parsed = parseFloat(value);
      if (isNaN(parsed) || parsed < 0) continue;
      applied[key] = parsed;
    } else {
      applied[key] = value;
    }
  }

  if (Object.keys(applied).length === 0) return { updated: false, settings: getAll() };

  const before = { ...settings };
  Object.assign(settings, applied);

  changeHistory.unshift({
    timestamp: new Date().toISOString(),
    changedBy,
    changes: applied,
    previous: Object.fromEntries(Object.keys(applied).map(k => [k, before[k]])),
  });

  // Keep last 50 changes
  if (changeHistory.length > 50) changeHistory.length = 50;

  return { updated: true, settings: getAll() };
}

function getHistory() {
  return [...changeHistory];
}

module.exports = { get, getAll, update, getHistory };
