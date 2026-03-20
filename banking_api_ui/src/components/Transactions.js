import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import apiClient from '../services/apiClient';

const Transactions = ({ user, onLogout }) => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/api/transactions');
      setTransactions(response.data.transactions);
    } catch (error) {
      console.error('Transactions error:', error);
      
      if (error.response?.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else if (error.response?.status === 403) {
        setError('You do not have permission to view transactions.');
      } else {
        setError('Failed to load transactions');
      }
    } finally {
      setLoading(false);
    }
  };

  const getTransactionTypeColor = (type) => {
    const colors = {
      'transfer': '#3b82f6',
      'deposit': '#10b981',
      'withdrawal': '#f59e0b'
    };
    return colors[type] || '#6b7280';
  };

  const getClientTypeIcon = (clientType) => {
    if (clientType === 'enduser') {
      return { icon: '👤', label: 'End User', color: '#3b82f6' };
    } else if (clientType === 'ai_agent') {
      return { icon: '🤖', label: 'AI Agent', color: '#8b5cf6' };
    } else {
      return { icon: '❓', label: 'Unknown', color: '#6b7280' };
    }
  };

  if (loading && transactions.length === 0) {
    return (
      <div className="loading">
        <div>Loading transactions...</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ color: '#1e293b' }}>Transactions</h1>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Transaction History</h2>
          <span style={{ color: '#64748b', fontSize: '0.875rem' }}>
            {transactions.length} transactions found
          </span>
        </div>

        {transactions.length > 0 ? (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Description</th>
                  <th>Client</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => {
                  const clientInfo = getClientTypeIcon(transaction.clientType);
                  return (
                    <tr key={transaction.id}>
                      <td>{format(new Date(transaction.createdAt), 'MMM dd, yyyy HH:mm')}</td>
                      <td>
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          borderRadius: '0.25rem',
                          fontSize: '0.75rem',
                          fontWeight: '500',
                          backgroundColor: getTransactionTypeColor(transaction.type),
                          color: 'white'
                        }}>
                          {transaction.type.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ 
                        fontWeight: '600', 
                        color: transaction.type === 'withdrawal' ? '#ef4444' : '#10b981' 
                      }}>
                        ${transaction.amount.toLocaleString()}
                      </td>
                      <td>{transaction.description}</td>
                      <td>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}>
                          <span style={{ fontSize: '1.2rem' }}>{clientInfo.icon}</span>
                          <span style={{
                            fontSize: '0.75rem',
                            color: clientInfo.color,
                            fontWeight: '500'
                          }}>
                            {clientInfo.label}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          borderRadius: '0.25rem',
                          fontSize: '0.75rem',
                          fontWeight: '500',
                          backgroundColor: transaction.status === 'completed' ? '#10b981' : '#f59e0b',
                          color: 'white'
                        }}>
                          {transaction.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No transactions found</h3>
            <p>No transactions are currently available.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Transactions;
