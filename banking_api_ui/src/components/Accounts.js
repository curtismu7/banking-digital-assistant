import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import apiClient from '../services/apiClient';

const Accounts = ({ user, onLogout }) => {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/api/accounts');
      setAccounts(response.data.accounts);
    } catch (error) {
      console.error('Accounts error:', error);
      
      if (error.response?.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else if (error.response?.status === 403) {
        setError('You do not have permission to view accounts.');
      } else {
        setError('Failed to load accounts');
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading && accounts.length === 0) {
    return (
      <div className="loading">
        <div>Loading accounts...</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ color: '#1e293b' }}>Accounts</h1>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Account Management</h2>
          <span style={{ color: '#64748b', fontSize: '0.875rem' }}>
            {accounts.length} accounts found
          </span>
        </div>

        {accounts.length > 0 ? (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Account Number</th>
                  <th>Type</th>
                  <th>Balance</th>
                  <th>Currency</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: '600' }}>
                      {account.accountNumber}
                    </td>
                    <td>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: '500',
                        backgroundColor: account.accountType === 'checking' ? '#3b82f6' : '#10b981',
                        color: 'white'
                      }}>
                        {account.accountType}
                      </span>
                    </td>
                    <td style={{ fontWeight: '600', color: account.balance >= 0 ? '#10b981' : '#ef4444' }}>
                      ${account.balance.toLocaleString()}
                    </td>
                    <td>{account.currency}</td>
                    <td>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: '500',
                        backgroundColor: account.isActive ? '#10b981' : '#6b7280',
                        color: 'white'
                      }}>
                        {account.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>{format(new Date(account.createdAt), 'MMM dd, yyyy')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No accounts found</h3>
            <p>No accounts are currently available.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Accounts;
