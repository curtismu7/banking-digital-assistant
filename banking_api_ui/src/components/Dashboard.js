import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import axios from 'axios';
import apiClient from '../services/apiClient';

const Dashboard = ({ user, onLogout }) => {
  const [stats, setStats] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [tokenData, setTokenData] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // Auto-refresh effect
  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchDashboardData();
      }, 5000); // 5 seconds
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [autoRefresh]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const [statsResponse, activityResponse] = await Promise.all([
        apiClient.get('/api/admin/stats'),
        apiClient.get('/api/admin/activity/recent?hours=24')
      ]);

      setStats(statsResponse.data.stats);
      setRecentActivity(activityResponse.data.logs);
    } catch (error) {
      console.error('Dashboard error:', error);
      
      if (error.response?.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else if (error.response?.status === 403) {
        setError('You do not have permission to access the admin dashboard.');
      } else {
        setError('Failed to load dashboard data');
      }
    } finally {
      setLoading(false);
    }
  };

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
      
      // Try both admin and user status endpoints using axios directly
      let response;
      try {
        console.log('🔍 Trying admin OAuth status endpoint...');
        response = await axios.get('/api/auth/oauth/status');
        console.log('👑 Admin OAuth response:', response.data);
        if (!response.data.authenticated) {
          console.log('🔍 Admin not authenticated, trying user OAuth status endpoint...');
          response = await axios.get('/api/auth/oauth/user/status');
          console.log('👤 User OAuth response:', response.data);
        }
      } catch (error) {
        console.log('❌ Admin OAuth failed, trying user OAuth status endpoint...', error.message);
        response = await axios.get('/api/auth/oauth/user/status');
        console.log('👤 User OAuth response:', response.data);
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

  if (loading) {
    return (
      <div className="loading">
        <div>Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error">
        {error}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif', backgroundColor: '#f8fafc', minHeight: '100vh' }}>
      <div style={{
        background: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)',
        color: 'white',
        padding: '40px',
        borderRadius: '8px',
        marginBottom: '32px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gridTemplateRows: '1fr 1fr',
              gap: '2px',
              width: '32px',
              height: '32px',
              padding: '4px',
              background: 'rgba(255, 255, 255, 0.2)',
              borderRadius: '6px',
              backdropFilter: 'blur(10px)'
            }}>
              <div style={{ background: 'white', borderRadius: '2px', opacity: '1' }}></div>
              <div style={{ background: 'white', borderRadius: '2px', opacity: '0.8' }}></div>
              <div style={{ background: 'white', borderRadius: '2px', opacity: '0.7' }}></div>
              <div style={{ background: 'white', borderRadius: '2px', opacity: '0.9' }}></div>
            </div>
            <span style={{ fontSize: '1.5rem', fontWeight: '700', letterSpacing: '-0.025em', color: 'white' }}>
              BX Finance
            </span>
          </div>
          <div>
            <h1 style={{ margin: '0 0 8px 0', fontSize: '2rem', fontWeight: '600', letterSpacing: '-0.025em' }}>
              Admin Dashboard
            </h1>
            <p style={{ margin: '0', opacity: '0.85', fontSize: '1rem', fontWeight: '400' }}>
              Welcome, {user?.firstName} {user?.lastName}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button 
            onClick={openTokenModal}
            title="View OAuth Token Info"
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: '2px solid rgba(255, 255, 255, 0.3)',
              color: 'white',
              padding: '10px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease',
              backdropFilter: 'blur(10px)',
              minWidth: '40px',
              height: '40px'
            }}
            onMouseOver={(e) => {
              e.target.style.background = 'rgba(255, 255, 255, 0.3)';
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.5)';
              e.target.style.transform = 'scale(1.05)';
            }}
            onMouseOut={(e) => {
              e.target.style.background = 'rgba(255, 255, 255, 0.2)';
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.3)';
              e.target.style.transform = 'scale(1)';
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.22,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.22,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.68 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/>
            </svg>
          </button>
          <button 
            onClick={onLogout}
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: '2px solid rgba(255, 255, 255, 0.3)',
              color: 'white',
              padding: '12px 24px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: '500',
              transition: 'all 0.3s ease',
              backdropFilter: 'blur(10px)'
            }}
            onMouseOver={(e) => {
              e.target.style.background = 'rgba(255, 255, 255, 0.3)';
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.5)';
              e.target.style.transform = 'translateY(-1px)';
            }}
            onMouseOut={(e) => {
              e.target.style.background = 'rgba(255, 255, 255, 0.2)';
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.3)';
              e.target.style.transform = 'translateY(0)';
            }}
          >
            Log Out
          </button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.totalUsers}</div>
          <div className="stat-label">Total Users</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.activeUsers}</div>
          <div className="stat-label">Active Users</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalAccounts}</div>
          <div className="stat-label">Total Accounts</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalTransactions}</div>
          <div className="stat-label">Total Transactions</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">${stats.totalBalance.toLocaleString()}</div>
          <div className="stat-label">Total Balance</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">${stats.averageBalance.toLocaleString()}</div>
          <div className="stat-label">Average Balance</div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Recent Activity (Last 24 Hours)</h2>
        </div>
        
        {recentActivity.length > 0 ? (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Endpoint</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentActivity.slice(0, 10).map((log) => (
                  <tr key={log.id}>
                    <td>{format(new Date(log.timestamp), 'MMM dd, HH:mm:ss')}</td>
                    <td>{log.username || 'Unknown'}</td>
                    <td>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: '500',
                        backgroundColor: getActionColor(log.action),
                        color: 'white'
                      }}>
                        {log.action}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      {log.endpoint}
                    </td>
                    <td>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: '500',
                        backgroundColor: log.responseStatus >= 400 ? '#ef4444' : '#10b981',
                        color: 'white'
                      }}>
                        {log.responseStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No recent activity</h3>
            <p>No activity has been recorded in the last 24 hours.</p>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Quick Actions</h2>
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button 
            className="btn btn-primary"
            onClick={() => window.location.href = '/activity'}
          >
            View All Activity Logs
          </button>
          <button 
            className="btn btn-secondary"
            onClick={() => window.location.href = '/users'}
          >
            Manage Users
          </button>
          <button 
            className="btn btn-secondary"
            onClick={() => window.location.href = '/accounts'}
          >
            Manage Accounts
          </button>
          <button 
            className="btn btn-secondary"
            onClick={() => window.location.href = '/transactions'}
          >
            View Transactions
          </button>
        </div>
      </div>

      {/* OAuth Token Info Modal */}
      {showTokenModal && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}
          onClick={() => setShowTokenModal(false)}
        >
          <div 
            style={{
              background: 'white',
              borderRadius: '12px',
              maxWidth: '900px',
              width: '100%',
              height: '80vh',
              maxHeight: '600px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              background: 'linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%)',
              color: 'white',
              padding: '20px 30px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexShrink: 0
            }}>
              <h3 style={{ margin: 0, fontSize: '1.5rem', fontWeight: '600' }}>OAuth Token Information</h3>
              <button 
                onClick={() => setShowTokenModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'white',
                  fontSize: '2rem',
                  cursor: 'pointer',
                  padding: 0,
                  width: '30px',
                  height: '30px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  transition: 'background 0.2s ease'
                }}
                onMouseOver={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.2)'}
                onMouseOut={(e) => e.target.style.background = 'none'}
              >
                ×
              </button>
            </div>
            <div style={{
              padding: '20px 30px 30px 30px',
              flex: 1,
              overflowY: 'auto',
              minHeight: 0
            }}>
              {tokenData ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                  <div style={{ border: '1px solid #e1e5e9', borderRadius: '8px', overflow: 'hidden' }}>
                    <h4 style={{
                      background: '#f8f9fa',
                      margin: 0,
                      padding: '15px 20px',
                      fontSize: '1.1rem',
                      fontWeight: '600',
                      color: '#2c3e50',
                      borderBottom: '1px solid #e1e5e9'
                    }}>Session Info</h4>
                    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                        <span style={{ fontWeight: '600', color: '#34495e', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>User:</span>
                        <span style={{ color: '#2c3e50', fontSize: '0.9rem', wordBreak: 'break-word' }}>{tokenData.user?.username} ({tokenData.user?.email})</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto 1fr', gap: '12px', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                        <span style={{ fontWeight: '600', color: '#34495e', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>Role:</span>
                        <span style={{ color: '#2c3e50', fontSize: '0.9rem', wordBreak: 'break-word' }}>{tokenData.user?.role}</span>
                        <span style={{ fontWeight: '600', color: '#34495e', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>Provider:</span>
                        <span style={{ color: '#2c3e50', fontSize: '0.9rem', wordBreak: 'break-word' }}>{tokenData.oauthProvider}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto 1fr', gap: '12px', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                        <span style={{ fontWeight: '600', color: '#34495e', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>Client:</span>
                        <span style={{ color: '#2c3e50', fontSize: '0.9rem', wordBreak: 'break-word' }}>{tokenData.clientType}</span>
                        <span style={{ fontWeight: '600', color: '#34495e', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>Token:</span>
                        <span style={{ color: '#2c3e50', fontSize: '0.9rem', wordBreak: 'break-word' }}>{tokenData.tokenType}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px', alignItems: 'center', padding: '8px 0' }}>
                        <span style={{ fontWeight: '600', color: '#34495e', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>Expires:</span>
                        <span style={{ color: '#2c3e50', fontSize: '0.9rem', wordBreak: 'break-word' }}>{tokenData.expiresAt ? new Date(tokenData.expiresAt).toLocaleString() : 'N/A'}</span>
                      </div>
                    </div>
                  </div>

                  {tokenData.accessToken && (
                    <div style={{ border: '1px solid #e1e5e9', borderRadius: '8px', overflow: 'hidden' }}>
                      <h4 style={{
                        background: '#f8f9fa',
                        margin: 0,
                        padding: '15px 20px',
                        fontSize: '1.1rem',
                        fontWeight: '600',
                        color: '#2c3e50',
                        borderBottom: '1px solid #e1e5e9'
                      }}>Access Token Header</h4>
                      <div style={{ padding: '20px' }}>
                        <pre style={{
                          background: '#f8f9fa',
                          border: '1px solid #e1e5e9',
                          borderRadius: '6px',
                          padding: '15px',
                          fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', monospace",
                          fontSize: '0.85rem',
                          lineHeight: '1.4',
                          color: '#2c3e50',
                          overflowX: 'auto',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all'
                        }}>
                          {JSON.stringify(tokenData.accessToken.header, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                  {tokenData.accessToken && (
                    <div style={{ border: '1px solid #e1e5e9', borderRadius: '8px', overflow: 'hidden' }}>
                      <h4 style={{
                        background: '#f8f9fa',
                        margin: 0,
                        padding: '15px 20px',
                        fontSize: '1.1rem',
                        fontWeight: '600',
                        color: '#2c3e50',
                        borderBottom: '1px solid #e1e5e9'
                      }}>Access Token Payload</h4>
                      <div style={{ padding: '20px' }}>
                        <pre style={{
                          background: '#f8f9fa',
                          border: '1px solid #e1e5e9',
                          borderRadius: '6px',
                          padding: '15px',
                          fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', monospace",
                          fontSize: '0.85rem',
                          lineHeight: '1.4',
                          color: '#2c3e50',
                          overflowX: 'auto',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all'
                        }}>
                          {JSON.stringify(tokenData.accessToken.payload, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                  {tokenData.accessToken && (
                    <div style={{ border: '1px solid #e1e5e9', borderRadius: '8px', overflow: 'hidden' }}>
                      <h4 style={{
                        background: '#f8f9fa',
                        margin: 0,
                        padding: '15px 20px',
                        fontSize: '1.1rem',
                        fontWeight: '600',
                        color: '#2c3e50',
                        borderBottom: '1px solid #e1e5e9'
                      }}>Raw Access Token</h4>
                      <div style={{ padding: '20px' }}>
                        <div style={{
                          background: '#f8f9fa',
                          border: '1px solid #e1e5e9',
                          borderRadius: '6px',
                          padding: '15px',
                          fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', monospace",
                          fontSize: '11px',
                          lineHeight: '1.4',
                          color: '#2c3e50',
                          wordBreak: 'break-all',
                          whiteSpace: 'pre-wrap',
                          maxHeight: '150px',
                          overflowY: 'auto'
                        }}>
                          {tokenData.accessToken.raw}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
                  <p>No OAuth token data available</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const getActionColor = (action) => {
  const colors = {
    'LOGIN': '#10b981',
    'REGISTER': '#3b82f6',
    'TRANSFER_MONEY': '#f59e0b',
    'CHECK_BALANCE': '#8b5cf6',
    'GET_TRANSACTIONS': '#06b6d4',
    'CREATE_USER': '#84cc16',
    'UPDATE_USER': '#f97316',
    'DELETE_USER': '#ef4444',
    'ADMIN_ACCESS': '#6366f1',
    'VIEW_ACTIVITY_LOGS': '#ec4899'
  };
  
  return colors[action] || '#6b7280';
};

export default Dashboard;
