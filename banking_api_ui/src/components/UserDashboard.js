import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import apiClient from '../services/apiClient';
import useChatWidget from '../hooks/useChatWidget';
import BankingAgent from './BankingAgent';
import './UserDashboard.css';

const UserDashboard = ({ user: propUser, onLogout }) => {
  const [user, setUser] = useState(propUser);
  const [accounts, setAccounts] = useState([]);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [tokenData, setTokenData] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [transferForm, setTransferForm] = useState({
    toAccountId: '',
    amount: '',
    description: ''
  });
  const [depositForm, setDepositForm] = useState({
    amount: '',
    description: ''
  });
  const [depositAccount, setDepositAccount] = useState(null);
  const [withdrawForm, setWithdrawForm] = useState({
    amount: '',
    description: ''
  });
  const [withdrawAccount, setWithdrawAccount] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [success, setSuccess] = useState(null);
  const [stepUpRequired, setStepUpRequired] = useState(false);

  // Auto-dismiss success messages after 4 seconds
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [success]);

  // Initialize chat widget (configuration is handled in index.html)
  const chatWidget = useChatWidget();

  // Function to decode JWT token
  const decodeToken = (token) => {
    try {
      if (!token) return null;
      
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      
      const header = JSON.parse(atob(parts[0]));
      const payload = JSON.parse(atob(parts[1]));
      
      return {
        header,
        payload,
        raw: token
      };
    } catch (error) {
      console.error('Error decoding token:', error);
      return null;
    }
  };

  // Function to fetch current OAuth tokens
  const fetchTokenData = async () => {
    try {
      console.log('🔍 Fetching current OAuth token data...');
      
      // Try both admin and user status endpoints
      let response;
      try {
        response = await axios.get('/api/auth/oauth/user/status');
        if (!response.data.authenticated) {
          response = await axios.get('/api/auth/oauth/status');
        }
      } catch (error) {
        response = await axios.get('/api/auth/oauth/status');
      }
      
      if (response.data.authenticated && response.data.accessToken) {
        const decodedAccessToken = decodeToken(response.data.accessToken);
        
        const tokenInfo = {
          accessToken: decodedAccessToken,
          tokenType: response.data.tokenType,
          expiresAt: response.data.expiresAt,
          clientType: response.data.clientType,
          oauthProvider: response.data.oauthProvider,
          user: response.data.user
        };
        
        console.log('✅ Token data fetched:', tokenInfo);
        setTokenData(tokenInfo);
      } else {
        console.log('❌ No authenticated session found');
        setTokenData(null);
      }
    } catch (error) {
      console.error('❌ Error fetching token data:', error);
      setTokenData(null);
    }
  };

  // Function to open token modal
  const openTokenModal = () => {
    fetchTokenData();
    setShowTokenModal(true);
  };

  useEffect(() => {
    // Initial data fetch
    fetchUserData();
  }, []);

  useEffect(() => {
    let refreshInterval;
    
    if (autoRefresh) {
      // Set up auto-refresh every 5 seconds
      refreshInterval = setInterval(() => {
        console.log('🔄 Auto-refreshing dashboard data...');
        fetchUserData(true); // Silent refresh - no loading spinner
      }, 5000); // 5 seconds
    }
    
    // Cleanup interval on component unmount or when autoRefresh changes
    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    };
  }, [autoRefresh]);

  const fetchUserData = async (silent = false) => {
    try {
      // Only show loading spinner for initial load, not auto-refreshes
      if (!silent) {
        setLoading(true);
      }

      // Check for OAuth session and get user info
      try {
        // Try end user OAuth session first
        const userSessionResponse = await axios.get('/api/auth/oauth/user/status');
        if (userSessionResponse.data.authenticated) {
          setUser(userSessionResponse.data.user);
        } else {
          // Try admin OAuth session as fallback
          const adminSessionResponse = await axios.get('/api/auth/oauth/status');
          if (adminSessionResponse.data.authenticated) {
            setUser(adminSessionResponse.data.user);
          } else {
            throw new Error('No valid OAuth session found');
          }
        }
      } catch (sessionError) {
        console.error('OAuth session error:', sessionError);
        setError('Please log in to access your account');
        if (!silent) {
          setLoading(false);
        }
        return;
      }

      // Get user's accounts using the new API client
      const accountsResponse = await apiClient.get('/api/accounts/my');
      setAccounts(accountsResponse.data.accounts);

      // Get user's transactions using the new API client
      const transactionsResponse = await apiClient.get('/api/transactions/my');
      setTransactions(transactionsResponse.data.transactions);

    } catch (error) {
      console.error('Error fetching user data:', error);
      
      // Check if it's an authentication error
      if (error.response?.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else if (error.response?.status === 403) {
        setError('You do not have permission to access this information.');
      } else {
        setError('Failed to load your account information');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const handleTransfer = async (e) => {
    e.preventDefault();

    if (!selectedAccount || !transferForm.toAccountId || !transferForm.amount) {
      setError('Please fill in all transfer details');
      return;
    }

    try {
      const response = await apiClient.post('/api/transactions', {
        fromAccountId: selectedAccount.id,
        toAccountId: transferForm.toAccountId,
        amount: parseFloat(transferForm.amount),
        type: 'transfer',
        description: transferForm.description || 'Transfer between accounts',
        userId: user.id
      });

      // Reset form and refresh data
      setTransferForm({ toAccountId: '', amount: '', description: '' });
      setSelectedAccount(null);
      await fetchUserData();

      setSuccess('Transfer completed successfully!');
    } catch (error) {
      console.error('Transfer error:', error);
      if (error.response?.status === 428) {
        setStepUpRequired(true);
      } else if (error.response?.status === 403) {
        setError('You do not have permission to perform transfers. Please contact your administrator.');
      } else {
        setError(error.response?.data?.error || 'Transfer failed');
      }
    }
  };

  const handleDeposit = async (e) => {
    e.preventDefault();

    if (!depositAccount || !depositForm.amount) {
      setError('Please fill in all deposit details');
      return;
    }

    try {
      const response = await apiClient.post('/api/transactions', {
        fromAccountId: null,
        toAccountId: depositAccount.id,
        amount: parseFloat(depositForm.amount),
        type: 'deposit',
        description: depositForm.description || 'Deposit to account',
        userId: user.id
      });

      // Reset form and refresh data
      setDepositForm({ amount: '', description: '' });
      setDepositAccount(null);
      await fetchUserData();

      setSuccess('Deposit completed successfully!');
    } catch (error) {
      console.error('Deposit error:', error);
      if (error.response?.status === 428) {
        setStepUpRequired(true);
      } else if (error.response?.status === 403) {
        setError('You do not have permission to make deposits. Please contact your administrator.');
      } else {
        setError(error.response?.data?.error || 'Deposit failed');
      }
    }
  };

  const handleWithdraw = async (e) => {
    e.preventDefault();

    if (!withdrawAccount || !withdrawForm.amount) {
      setError('Please fill in all withdrawal details');
      return;
    }

    try {
      const response = await apiClient.post('/api/transactions', {
        fromAccountId: withdrawAccount.id,
        toAccountId: null,
        amount: parseFloat(withdrawForm.amount),
        type: 'withdrawal',
        description: withdrawForm.description || 'Withdrawal from account',
        userId: user.id
      });

      // Reset form and refresh data
      setWithdrawForm({ amount: '', description: '' });
      setWithdrawAccount(null);
      await fetchUserData();

      setSuccess('Withdrawal completed successfully!');
    } catch (error) {
      console.error('Withdrawal error:', error);
      if (error.response?.status === 428) {
        setStepUpRequired(true);
      } else if (error.response?.status === 403) {
        setError('You do not have permission to make withdrawals. Please contact your administrator.');
      } else {
        setError(error.response?.data?.error || 'Withdrawal failed');
      }
    }
  };

  const getAccountBalance = (accountId) => {
    const account = accounts.find(acc => acc.id === accountId);
    return account ? account.balance : 0;
  };

  // Function to determine if a transaction represents money going out (negative) or coming in (positive)
  const isTransactionNegative = (transaction) => {
    // For withdrawals, money is going out (negative)
    if (transaction.type === 'withdrawal') {
      return true;
    }

    // For deposits, money is coming in (positive)
    if (transaction.type === 'deposit') {
      return false;
    }

    // For other transaction types, determine based on which account is involved
    // If this transaction has a fromAccountId, it means money is going out from that account
    if (transaction.fromAccountId) {
      return true;
    }
    // If this transaction has a toAccountId but no fromAccountId, it means money is coming in
    if (transaction.toAccountId && !transaction.fromAccountId) {
      return false;
    }

    // Default to positive for unknown transaction types
    return false;
  };

  const getClientTypeIcon = (clientType) => {
    if (clientType === 'enduser') {
      return { icon: '◉', label: 'End User', color: '#4b5563' };
    } else if (clientType === 'ai_agent') {
      return { icon: '◎', label: 'AI Agent', color: '#6b7280' };
    } else {
      return { icon: '○', label: 'Unknown', color: '#9ca3af' };
    }
  };

  if (loading) {
    return (
      <div className="user-dashboard">
        <div className="loading">Loading your account information...</div>
      </div>
    );
  }

  const dashboardStyle = {
    background: `
      linear-gradient(rgba(248, 250, 252, 0.85), rgba(248, 250, 252, 0.85)),
      url(${process.env.PUBLIC_URL}/images/pexels-1462751220-33995750.jpg)
    `,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'fixed',
    backgroundRepeat: 'no-repeat'
  };

  return (
    <div className="user-dashboard" style={dashboardStyle}>
      {error && (
        <div className="inline-message inline-message--error" onClick={() => setError(null)}>
          {error} <span className="inline-message__dismiss">✕</span>
        </div>
      )}
      {success && (
        <div className="inline-message inline-message--success" onClick={() => setSuccess(null)}>
          {success} <span className="inline-message__dismiss">✕</span>
        </div>
      )}
      {stepUpRequired && (
        <div className="inline-message inline-message--warning">
          <strong>🔐 Additional verification required</strong>
          <span style={{ marginLeft: 8 }}>
            Transfers and withdrawals of $250 or more require MFA. Please verify your identity to continue.
          </span>
          <a
            href="/api/auth/oauth/user/stepup?return_to=http://localhost:4000/dashboard"
            className="inline-message__action"
            style={{ marginLeft: 12, fontWeight: 600, color: 'inherit', textDecoration: 'underline' }}
          >
            Verify now →
          </a>
          <span
            className="inline-message__dismiss"
            onClick={() => setStepUpRequired(false)}
            style={{ marginLeft: 12, cursor: 'pointer' }}
          >
            ✕
          </span>
        </div>
      )}
      <div className="dashboard-header">
        <div className="bank-branding">
          <div className="bank-logo">
            <div className="logo-icon">
              <div className="logo-square"></div>
              <div className="logo-square"></div>
              <div className="logo-square"></div>
              <div className="logo-square"></div>
            </div>
            <span className="bank-name">BX Finance</span>
          </div>
        </div>
        <div className="header-right">
          <div className="user-info">
            <span className="user-greeting">Hello, {user?.firstName} {user?.lastName}</span>
            <span className="user-email">{user?.email}</span>
          </div>
          <div className="header-actions">
            <div className="auto-refresh-toggle">
              <label className="toggle-label">
                <span className="toggle-text">Auto-refresh</span>
                <div className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                    className="toggle-input"
                  />
                  <span className="toggle-slider"></span>
                </div>
              </label>
            </div>
            <button onClick={openTokenModal} className="token-info-btn" title="View OAuth Token Info">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.22,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.22,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.68 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/>
              </svg>
            </button>
            <button onClick={onLogout} className="logout-btn">
              Log Out
            </button>
          </div>
        </div>
      </div>

      <div className="dashboard-content">
        {/* Account Summary */}
        <div className="section">
          <h2>Your Accounts</h2>
          <div className="accounts-grid">
            {accounts.map(account => (
              <div key={account.id} className="account-card">
                <div className="account-header">
                  <h3>{account.name}</h3>
                  <span className={`account-type-badge ${(account.accountType || account.type || 'unknown').toLowerCase()}`}>
                    {(account.accountType || account.type) ?
                      (account.accountType || account.type).charAt(0).toUpperCase() + (account.accountType || account.type).slice(1) :
                      'Unknown'}
                  </span>
                </div>
                <p className="account-number">Account: {account.accountNumber}</p>
                <p className="balance">Balance: ${account.balance.toFixed(2)}</p>
                <div className="account-actions">
                  <button
                    className="select-account-btn"
                    onClick={() => setSelectedAccount(account)}
                  >
                    Select for Transfer
                  </button>
                  <button
                    className="deposit-btn"
                    onClick={() => setDepositAccount(account)}
                  >
                    Deposit
                  </button>
                  <button
                    className="withdraw-btn"
                    onClick={() => setWithdrawAccount(account)}
                  >
                    Withdraw
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Transfer Form */}
        {selectedAccount && (
          <div className="section">
            <h2>Transfer Money</h2>
            <div className="transfer-form">
              <p>From: {selectedAccount.accountType} - {selectedAccount.accountNumber} (${selectedAccount.balance.toFixed(2)})</p>
              <form onSubmit={handleTransfer}>
                <div className="form-group">
                  <label>To Account:</label>
                  <select
                    value={transferForm.toAccountId}
                    onChange={(e) => setTransferForm({ ...transferForm, toAccountId: e.target.value })}
                    required
                  >
                    <option value="">Select destination account</option>
                    {accounts
                      .filter(account => account.id !== selectedAccount.id)
                      .map(account => (
                        <option key={account.id} value={account.id}>
                          {account.accountType} - {account.accountNumber} (${account.balance.toFixed(2)})
                        </option>
                      ))
                    }
                  </select>
                </div>
                <div className="form-group">
                  <label>Amount:</label>
                  <input
                    type="number"
                    step="0.01"
                    value={transferForm.amount}
                    onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
                    placeholder="Enter amount"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Description:</label>
                  <input
                    type="text"
                    value={transferForm.description}
                    onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })}
                    placeholder="Transfer description"
                  />
                </div>
                <div className="form-actions">
                  <button type="submit" className="transfer-btn">Transfer</button>
                  <button
                    type="button"
                    className="cancel-btn"
                    onClick={() => {
                      setSelectedAccount(null);
                      setTransferForm({ toAccountId: '', amount: '', description: '' });
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Deposit Form */}
        {depositAccount && (
          <div className="section">
            <h2>Deposit Money</h2>
            <div className="deposit-form">
              <p>To: {depositAccount.accountType} - {depositAccount.accountNumber} (${depositAccount.balance.toFixed(2)})</p>
              <form onSubmit={handleDeposit}>
                <div className="form-group">
                  <label>Amount:</label>
                  <input
                    type="number"
                    step="0.01"
                    value={depositForm.amount}
                    onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })}
                    placeholder="Enter amount"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Description:</label>
                  <input
                    type="text"
                    value={depositForm.description}
                    onChange={(e) => setDepositForm({ ...depositForm, description: e.target.value })}
                    placeholder="Deposit description"
                  />
                </div>
                <div className="form-actions">
                  <button type="submit" className="deposit-submit-btn">Deposit</button>
                  <button
                    type="button"
                    className="cancel-btn"
                    onClick={() => {
                      setDepositAccount(null);
                      setDepositForm({ amount: '', description: '' });
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Withdraw Form */}
        {withdrawAccount && (
          <div className="section">
            <h2>Withdraw Money</h2>
            <div className="withdraw-form">
              <p>From: {withdrawAccount.accountType} - {withdrawAccount.accountNumber} (${withdrawAccount.balance.toFixed(2)})</p>
              <form onSubmit={handleWithdraw}>
                <div className="form-group">
                  <label>Amount:</label>
                  <input
                    type="number"
                    step="0.01"
                    value={withdrawForm.amount}
                    onChange={(e) => setWithdrawForm({ ...withdrawForm, amount: e.target.value })}
                    placeholder="Enter amount"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Description:</label>
                  <input
                    type="text"
                    value={withdrawForm.description}
                    onChange={(e) => setWithdrawForm({ ...withdrawForm, description: e.target.value })}
                    placeholder="Withdrawal description"
                  />
                </div>
                <div className="form-actions">
                  <button type="submit" className="withdraw-submit-btn">Withdraw</button>
                  <button
                    type="button"
                    className="cancel-btn"
                    onClick={() => {
                      setWithdrawAccount(null);
                      setWithdrawForm({ amount: '', description: '' });
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Recent Transactions */}
        <div className="section">
          <h2>Recent Transactions</h2>
          <div className="transactions-table">
            <div className="transaction-header">
              <div className="header-cell">Date</div>
              <div className="header-cell">Type</div>
              <div className="header-cell">Amount</div>
              <div className="header-cell">Description</div>
              <div className="header-cell">Account</div>
              <div className="header-cell">Interface</div>
              <div className="header-cell">User</div>
            </div>
            <div className="transactions-list">
              {transactions
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, 20)
                .map(transaction => {
                  const clientInfo = getClientTypeIcon(transaction.clientType);
                  return (
                    <div key={transaction.id} className="transaction-row">
                      <div className="transaction-cell">
                        <span className="transaction-date">
                          {format(new Date(transaction.createdAt), 'MMM dd, yyyy HH:mm')}
                        </span>
                      </div>
                      <div className="transaction-cell">
                        <span className="transaction-type">{transaction.type}</span>
                      </div>
                      <div className="transaction-cell">
                        <span className={`transaction-amount ${isTransactionNegative(transaction) ? 'negative' : 'positive'}`}>
                          {isTransactionNegative(transaction) ? '-' : '+'}
                          ${transaction.amount.toFixed(2)}
                        </span>
                      </div>
                      <div className="transaction-cell">
                        <span className="transaction-description">{transaction.description}</span>
                      </div>
                      <div className="transaction-cell">
                        <span className="transaction-account">{transaction.accountInfo || 'Unknown'}</span>
                      </div>
                      <div className="transaction-cell">
                        <div className="interface-indicator">
                          <span className="interface-icon" style={{ color: clientInfo.color }}>
                            {clientInfo.icon}
                          </span>
                          <span className="interface-label" style={{ color: clientInfo.color }}>
                            {clientInfo.label}
                          </span>
                        </div>
                      </div>
                      <div className="transaction-cell">
                        <span className="transaction-user">{transaction.performedBy || 'Unknown'}</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>

      {/* OAuth Token Info Modal */}
      {showTokenModal && (
        <div className="modal-overlay" onClick={() => setShowTokenModal(false)}>
          <div className="token-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>OAuth Token Information</h3>
              <button className="close-btn" onClick={() => setShowTokenModal(false)}>×</button>
            </div>
            <div className="modal-content">
              {tokenData ? (
                <div className="token-info">
                  <div className="token-section">
                    <h4>Session Info</h4>
                    <div className="session-info-grid">
                      <div className="session-row">
                        <span className="session-label">User:</span>
                        <span className="session-value">{tokenData.user?.username} ({tokenData.user?.email})</span>
                      </div>
                      <div className="session-row">
                        <span className="session-label">Role:</span>
                        <span className="session-value">{tokenData.user?.role}</span>
                        <span className="session-label">Provider:</span>
                        <span className="session-value">{tokenData.oauthProvider}</span>
                      </div>
                      <div className="session-row">
                        <span className="session-label">Client:</span>
                        <span className="session-value">{tokenData.clientType}</span>
                        <span className="session-label">Token:</span>
                        <span className="session-value">{tokenData.tokenType}</span>
                      </div>
                      <div className="session-row">
                        <span className="session-label">Expires:</span>
                        <span className="session-value">{tokenData.expiresAt ? new Date(tokenData.expiresAt).toLocaleString() : 'N/A'}</span>
                      </div>
                    </div>
                  </div>

                  {tokenData.accessToken && (
                    <div className="token-section">
                      <h4>Access Token Header</h4>
                      <pre className="token-json">
                        {JSON.stringify(tokenData.accessToken.header, null, 2)}
                      </pre>
                    </div>
                  )}

                  {tokenData.accessToken && (
                    <div className="token-section">
                      <h4>Access Token Payload</h4>
                      <pre className="token-json">
                        {JSON.stringify(tokenData.accessToken.payload, null, 2)}
                      </pre>
                    </div>
                  )}

                  {tokenData.accessToken && (
                    <div className="token-section">
                      <h4>Raw Access Token</h4>
                      <div className="token-raw-display">
                        {tokenData.accessToken.raw}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="no-token">
                  <p>No OAuth token data available</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Banking AI Assistant — floating chat panel */}
      <BankingAgent user={user} />
    </div>
  );
};

export default UserDashboard;
