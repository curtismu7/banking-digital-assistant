import React, { useState, useRef, useEffect } from 'react';
import {
  getMyAccounts,
  getAccountBalance,
  getMyTransactions,
  createTransfer,
  createDeposit,
  createWithdrawal,
} from '../services/bankingAgentService';
import './BankingAgent.css';

// ─── Action definitions ────────────────────────────────────────────────────────

const ACTIONS = [
  { id: 'accounts',     label: '🏦 My Accounts',       desc: 'List all your accounts' },
  { id: 'transactions', label: '📋 Recent Transactions', desc: 'View recent activity' },
  { id: 'balance',      label: '💰 Check Balance',      desc: 'Balance for an account' },
  { id: 'deposit',      label: '⬇ Deposit',             desc: 'Deposit into an account' },
  { id: 'withdraw',     label: '⬆ Withdraw',            desc: 'Withdraw from an account' },
  { id: 'transfer',     label: '↔ Transfer',            desc: 'Transfer between accounts' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(n) {
  return typeof n === 'number'
    ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : n;
}

function formatResult(result) {
  if (!result) return 'No data returned.';
  // Accounts list
  if (result.accounts) {
    return result.accounts.map(a =>
      `${a.account_type || a.type || 'Account'}: ${a.account_number || a.id}\n  Balance: ${formatCurrency(a.balance)}`
    ).join('\n\n');
  }
  // Transactions list
  if (result.transactions) {
    return result.transactions.slice(0, 10).map(t =>
      `${t.type}: ${formatCurrency(t.amount)} — ${t.description || ''}\n  ${new Date(t.created_at || t.createdAt).toLocaleDateString()}`
    ).join('\n\n');
  }
  // Balance response
  if (result.balance !== undefined) {
    return `Balance: ${formatCurrency(result.balance)}`;
  }
  // Transaction confirmation
  if (result.transaction_id || result.transactionId || result.id) {
    return `✅ Success\nTransaction ID: ${result.transaction_id || result.transactionId || result.id}\nAmount: ${formatCurrency(result.amount)}`;
  }
  return JSON.stringify(result, null, 2);
}

// ─── Input form for actions that need parameters ──────────────────────────────

function ActionForm({ action, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState({});
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const fields = {
    balance:  [{ key: 'accountId', label: 'Account ID', placeholder: 'e.g. acc_abc123' }],
    deposit:  [
      { key: 'accountId', label: 'Account ID', placeholder: 'e.g. acc_abc123' },
      { key: 'amount',    label: 'Amount ($)',  placeholder: '0.00', type: 'number' },
      { key: 'note',      label: 'Note',        placeholder: 'optional' },
    ],
    withdraw: [
      { key: 'accountId', label: 'Account ID', placeholder: 'e.g. acc_abc123' },
      { key: 'amount',    label: 'Amount ($)',  placeholder: '0.00', type: 'number' },
      { key: 'note',      label: 'Note',        placeholder: 'optional' },
    ],
    transfer: [
      { key: 'fromId',    label: 'From Account ID', placeholder: 'e.g. acc_abc123' },
      { key: 'toId',      label: 'To Account ID',   placeholder: 'e.g. acc_def456' },
      { key: 'amount',    label: 'Amount ($)',        placeholder: '0.00', type: 'number' },
      { key: 'note',      label: 'Note',              placeholder: 'optional' },
    ],
  };

  return (
    <div className="banking-agent-form">
      {(fields[action] || []).map(f => (
        <div key={f.key} className="banking-agent-field">
          <label>{f.label}</label>
          <input
            type={f.type || 'text'}
            placeholder={f.placeholder}
            value={form[f.key] || ''}
            onChange={e => set(f.key, e.target.value)}
          />
        </div>
      ))}
      <div className="banking-agent-form-actions">
        <button className="banking-agent-btn-primary" disabled={loading} onClick={() => onSubmit(form)}>
          {loading ? '…' : 'Run'}
        </button>
        <button className="banking-agent-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function BankingAgent({ user }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  function addMessage(role, content, tool) {
    setMessages(prev => [...prev, { id: Date.now().toString(), role, content, tool }]);
  }

  async function runAction(actionId, form) {
    setActiveAction(null);
    const label = ACTIONS.find(a => a.id === actionId)?.label || actionId;
    addMessage('user', label);
    setLoading(true);

    try {
      let result;
      switch (actionId) {
        case 'accounts':
          result = await getMyAccounts();
          break;
        case 'transactions':
          result = await getMyTransactions();
          break;
        case 'balance':
          result = await getAccountBalance(form.accountId);
          break;
        case 'deposit':
          result = await createDeposit(form.accountId, parseFloat(form.amount), form.note);
          break;
        case 'withdraw':
          result = await createWithdrawal(form.accountId, parseFloat(form.amount), form.note);
          break;
        case 'transfer':
          result = await createTransfer(form.fromId, form.toId, parseFloat(form.amount), form.note);
          break;
        default:
          throw new Error(`Unknown action: ${actionId}`);
      }
      addMessage('assistant', formatResult(result), actionId);
    } catch (err) {
      const isConnErr =
        err.message.includes('timed out') ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('ENETUNREACH') ||
        err.message.includes('mcp_error') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('502');
      addMessage(
        'error',
        isConnErr
          ? 'Banking Agent is unavailable.\n\nThe MCP server is not reachable.\n\nLocal: cd banking_mcp_server && npm run dev\nVercel: set MCP_SERVER_URL to your hosted MCP server URL.'
          : `Error: ${err.message}`,
        actionId
      );
    } finally {
      setLoading(false);
    }
  }

  function handleActionClick(actionId) {
    // No form needed for read-only queries
    if (actionId === 'accounts' || actionId === 'transactions') {
      runAction(actionId, {});
    } else {
      setActiveAction(actionId);
    }
  }

  return (
    <>
      {/* FAB */}
      <button
        className={`banking-agent-fab ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(v => !v)}
        aria-label={isOpen ? 'Close agent panel' : 'Open banking agent'}
        title="Banking MCP Agent"
      >
        {isOpen ? '✕' : '🤖'}
      </button>

      {/* Panel */}
      {isOpen && (
        <div className="banking-agent-panel" role="dialog" aria-label="Banking MCP Agent">
          {/* Header */}
          <div className="banking-agent-header">
            <div className="banking-agent-header-info">
              <span className="banking-agent-avatar">🏦</span>
              <div>
                <div className="banking-agent-title">Banking Agent</div>
                <div className="banking-agent-subtitle">Powered by MCP · {user?.name?.split(' ')[0] || 'Secure'}</div>
              </div>
            </div>
            <button className="banking-agent-close-btn" onClick={() => setIsOpen(false)} aria-label="Close">✕</button>
          </div>

          {/* Messages */}
          <div className="banking-agent-messages">
            {messages.length === 0 && (
              <div className="banking-agent-welcome">
                <p>Select an action below to interact with your accounts via the MCP server.</p>
              </div>
            )}
            {messages.map(msg => (
              <div key={msg.id} className={`banking-agent-msg ${msg.role}`}>
                {msg.role === 'assistant' && <span className="banking-agent-msg-avatar">🏦</span>}
                <div className="banking-agent-msg-bubble">
                  <pre className="banking-agent-msg-text">{msg.content}</pre>
                  {msg.tool && <span className="banking-agent-tool-badge">⚙ {msg.tool}</span>}
                </div>
              </div>
            ))}
            {loading && (
              <div className="banking-agent-msg assistant typing">
                <span className="banking-agent-msg-avatar">🏦</span>
                <div className="banking-agent-msg-bubble">
                  <span className="banking-agent-dots"><span /><span /><span /></span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Action form (when user selects a transaction action) */}
          {activeAction && (
            <ActionForm
              action={activeAction}
              loading={loading}
              onSubmit={form => runAction(activeAction, form)}
              onCancel={() => setActiveAction(null)}
            />
          )}

          {/* Action buttons */}
          {!activeAction && (
            <div className="banking-agent-actions">
              {ACTIONS.map(a => (
                <button
                  key={a.id}
                  className="banking-agent-action-btn"
                  onClick={() => handleActionClick(a.id)}
                  disabled={loading}
                  title={a.desc}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

