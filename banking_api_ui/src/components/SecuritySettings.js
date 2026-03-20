import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../services/apiClient';

// ── Helper ────────────────────────────────────────────────────────────────────

const FIELD_META = {
  stepUpEnabled: {
    label: 'Step-up MFA Enabled',
    type: 'toggle',
    description: 'When disabled, ALL transactions bypass the MFA step-up gate.',
  },
  stepUpAmountThreshold: {
    label: 'Step-up Threshold ($)',
    type: 'number',
    min: 1,
    max: 100000,
    description: 'Transfers and withdrawals at or above this amount require MFA re-authentication.',
  },
  stepUpAcrValue: {
    label: 'Required ACR Value',
    type: 'text',
    description: 'Must match the PingOne Sign-On Policy name exactly (e.g. Multi_factor).',
  },
  stepUpTransactionTypes: {
    label: 'Transaction Types Requiring Step-up',
    type: 'multiselect',
    options: ['transfer', 'withdrawal', 'deposit'],
    description: 'Only selected types will trigger step-up for high-value amounts.',
  },
  authorizeEnabled: {
    label: 'PingOne Authorize Integration',
    type: 'toggle',
    description: 'Route authorization decisions through PingOne Authorize. When enabled, every non-admin transaction is evaluated against the policy below. Works alongside (not instead of) the step-up threshold above.',
  },
  authorizePolicyId: {
    label: 'Authorize Policy ID',
    type: 'text',
    description: 'PingOne Authorize policy decision point (PDP) ID. Required when PingOne Authorize Integration is enabled. Configure PINGONE_AUTHORIZE_WORKER_CLIENT_ID and PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET in server .env.',
  },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Toggle({ value, onChange, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        width: '48px',
        height: '26px',
        borderRadius: '13px',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: value ? '#1d4ed8' : '#d1d5db',
        transition: 'background 0.2s',
        padding: 0,
        opacity: disabled ? 0.5 : 1,
      }}
      aria-pressed={value}
    >
      <span
        style={{
          position: 'absolute',
          top: '3px',
          left: value ? '25px' : '3px',
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          background: 'white',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  );
}

function MultiSelect({ value = [], options, onChange, disabled }) {
  const toggle = (opt) => {
    if (disabled) return;
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt]);
  };
  return (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          disabled={disabled}
          onClick={() => toggle(opt)}
          style={{
            padding: '4px 12px',
            borderRadius: '20px',
            border: '2px solid',
            borderColor: value.includes(opt) ? '#1d4ed8' : '#d1d5db',
            background: value.includes(opt) ? '#eff6ff' : 'white',
            color: value.includes(opt) ? '#1d4ed8' : '#6b7280',
            fontWeight: value.includes(opt) ? '600' : '400',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: '0.85rem',
            transition: 'all 0.15s',
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const SecuritySettings = ({ user }) => {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [dirty, setDirty] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/api/admin/settings');
      setSettings(res.data.settings);
      setForm({ ...res.data.settings });
      setHistory(res.data.history || []);
      setDirty(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const set = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setDirty(true);
    setSuccessMsg('');
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      const res = await apiClient.put('/api/admin/settings', form);
      setSettings(res.data.settings);
      setForm({ ...res.data.settings });
      setDirty(false);
      setSuccessMsg('Settings saved successfully.');
      // Re-fetch history
      const full = await apiClient.get('/api/admin/settings');
      setHistory(full.data.history || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setForm({ ...settings });
    setDirty(false);
    setSuccessMsg('');
    setError('');
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
        Loading settings…
      </div>
    );
  }

  const fieldOrder = [
    'stepUpEnabled',
    'stepUpAmountThreshold',
    'stepUpAcrValue',
    'stepUpTransactionTypes',
    'authorizeEnabled',
    'authorizePolicyId',
  ];

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', backgroundColor: '#f8fafc', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)', color: 'white', padding: '32px 40px', borderRadius: '8px', marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '1.75rem' }}>🔐</span>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: '600' }}>Security Settings</h1>
            <p style={{ margin: '4px 0 0', opacity: 0.85, fontSize: '0.9rem' }}>
              Live configuration — changes take effect immediately, no restart required
            </p>
          </div>
        </div>
        <button
          onClick={() => window.location.href = '/admin'}
          style={{ background: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.3)', color: 'white', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '500' }}
        >
          ← Admin Dashboard
        </button>
      </div>

      {/* Alert messages */}
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c', padding: '12px 16px', borderRadius: '6px', marginBottom: '16px' }}>
          ⚠ {error}
        </div>
      )}
      {successMsg && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#166534', padding: '12px 16px', borderRadius: '6px', marginBottom: '16px' }}>
          ✓ {successMsg}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '24px', alignItems: 'start' }}>

        {/* Settings form */}
        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: '600', color: '#111827' }}>
              Step-up MFA &amp; Authorization Policy
            </h2>
            {dirty && <span style={{ fontSize: '0.8rem', color: '#f59e0b', fontWeight: '600' }}>● Unsaved changes</span>}
          </div>

          <div style={{ padding: '24px' }}>
            {fieldOrder.map((key) => {
              const meta = FIELD_META[key];
              if (!meta || form[key] === undefined) return null;
              return (
                <div key={key} style={{ marginBottom: '28px', paddingBottom: '28px', borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div>
                      <label style={{ display: 'block', fontWeight: '600', color: '#374151', fontSize: '0.9rem', marginBottom: '4px' }}>
                        {meta.label}
                        {meta.disabled && <span style={{ marginLeft: '8px', fontSize: '0.75rem', background: '#f3f4f6', color: '#9ca3af', padding: '2px 6px', borderRadius: '4px' }}>Coming soon</span>}
                      </label>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: '#6b7280' }}>{meta.description}</p>
                    </div>
                  </div>

                  {meta.type === 'toggle' && (
                    <Toggle value={form[key]} onChange={(v) => set(key, v)} disabled={meta.disabled} />
                  )}

                  {meta.type === 'number' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: '#6b7280', fontWeight: '600' }}>$</span>
                      <input
                        type="number"
                        min={meta.min}
                        max={meta.max}
                        value={form[key]}
                        disabled={meta.disabled}
                        onChange={(e) => set(key, e.target.value)}
                        style={{ width: '160px', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.95rem', color: '#111827' }}
                      />
                    </div>
                  )}

                  {meta.type === 'text' && (
                    <input
                      type="text"
                      value={form[key]}
                      disabled={meta.disabled}
                      onChange={(e) => set(key, e.target.value)}
                      style={{ width: '100%', maxWidth: '400px', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', color: '#111827', opacity: meta.disabled ? 0.5 : 1 }}
                    />
                  )}

                  {meta.type === 'multiselect' && (
                    <MultiSelect
                      value={form[key]}
                      options={meta.options}
                      onChange={(v) => set(key, v)}
                      disabled={meta.disabled}
                    />
                  )}
                </div>
              );
            })}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '12px', paddingTop: '8px' }}>
              <button
                onClick={handleSave}
                disabled={!dirty || saving}
                style={{ padding: '10px 24px', background: dirty ? '#1d4ed8' : '#9ca3af', color: 'white', border: 'none', borderRadius: '6px', fontWeight: '600', fontSize: '0.875rem', cursor: dirty ? 'pointer' : 'not-allowed', transition: 'background 0.2s' }}
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button
                onClick={handleReset}
                disabled={!dirty || saving}
                style={{ padding: '10px 24px', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontWeight: '500', fontSize: '0.875rem', cursor: dirty ? 'pointer' : 'not-allowed' }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>

        {/* Change history sidebar */}
        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: '600', color: '#111827' }}>Change History</h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: '#9ca3af' }}>Last 50 changes · in-memory</p>
          </div>
          <div style={{ maxHeight: '520px', overflowY: 'auto', padding: '8px 0' }}>
            {history.length === 0 ? (
              <p style={{ padding: '16px 20px', color: '#9ca3af', fontSize: '0.85rem', margin: 0 }}>No changes yet.</p>
            ) : (
              history.map((entry, i) => (
                <div key={i} style={{ padding: '12px 20px', borderBottom: '1px solid #f9fafb' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontWeight: '600', fontSize: '0.8rem', color: '#374151' }}>{entry.changedBy}</span>
                    <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                      {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {Object.entries(entry.changes).map(([k, v]) => (
                    <div key={k} style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '2px' }}>
                      <span style={{ color: '#374151', fontWeight: '500' }}>{k}:</span>{' '}
                      <span style={{ textDecoration: 'line-through', color: '#d1d5db' }}>
                        {JSON.stringify(entry.previous[k])}
                      </span>{' '}→ <span style={{ color: '#059669' }}>{JSON.stringify(v)}</span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SecuritySettings;
