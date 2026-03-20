/**
 * Banking Agent service — MCP edition.
 *
 * Calls the banking_api_server's `/api/mcp/tool` proxy, which in turn
 * forwards requests to the banking_mcp_server via WebSocket (JSON-RPC).
 * No external AI API key is required.
 */

// ─── Low-level MCP tool call ──────────────────────────────────────────────────

/**
 * Execute a single MCP tool via the server-side proxy.
 * @param {string} tool   - MCP tool name (e.g. 'get_my_accounts')
 * @param {object} params - Tool parameters
 */
export async function callMcpTool(tool, params = {}) {
  const response = await fetch('/api/mcp/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, params }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(err.message || `MCP error: ${response.status}`);
  }

  const data = await response.json();
  return data.result;
}

// ─── Named tool helpers ───────────────────────────────────────────────────────

export function getMyAccounts() {
  return callMcpTool('get_my_accounts');
}

export function getAccountBalance(accountId) {
  return callMcpTool('get_account_balance', { account_id: accountId });
}

export function getMyTransactions(limit = 10) {
  return callMcpTool('get_my_transactions', { limit });
}

export function createTransfer(fromAccountId, toAccountId, amount, description = 'Agent transfer') {
  return callMcpTool('create_transfer', {
    from_account_id: fromAccountId,
    to_account_id: toAccountId,
    amount,
    description,
  });
}

export function createDeposit(accountId, amount, description = 'Agent deposit') {
  return callMcpTool('create_deposit', { account_id: accountId, amount, description });
}

export function createWithdrawal(accountId, amount, description = 'Agent withdrawal') {
  return callMcpTool('create_withdrawal', { account_id: accountId, amount, description });
}
