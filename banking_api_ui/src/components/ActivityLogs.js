import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import apiClient from '../services/apiClient';

const ActivityLogs = ({ user, onLogout }) => {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedLog, setSelectedLog] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [filters, setFilters] = useState({
    page: 1,
    limit: 50,
    username: '',
    action: '',
    startDate: '',
    endDate: ''
  });

  useEffect(() => {
    fetchLogs();
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.append(key, value);
      });

      const response = await apiClient.get(`/api/admin/activity?${params}`);
      setLogs(response.data.logs);
      setPagination(response.data.pagination);
    } catch (error) {
      console.error('Activity logs error:', error);
      
      if (error.response?.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else if (error.response?.status === 403) {
        setError('You do not have permission to view activity logs.');
      } else {
        setError('Failed to load activity logs');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      page: 1 // Reset to first page when filters change
    }));
  };

  const handlePageChange = (page) => {
    setFilters(prev => ({ ...prev, page }));
  };

  const exportLogs = async () => {
    try {
      const response = await apiClient.get('/api/admin/activity/export', {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `activity_logs_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Export error:', error);
    }
  };

  const clearOldLogs = async () => {
    if (window.confirm('Are you sure you want to clear logs older than 30 days?')) {
      try {
        await apiClient.delete('/api/admin/activity/clear?days=30');
        fetchLogs(); // Refresh the list
      } catch (error) {
        console.error('Clear logs error:', error);
      }
    }
  };

  const handleRowClick = (log) => {
    setSelectedLog(log);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedLog(null);
  };

  const copyAsCurl = () => {
    if (!selectedLog) return;

    // Extract method and endpoint from the log
    const [method, endpoint] = selectedLog.endpoint.split(' ');
    
    // Map the stored endpoint to the actual API endpoint
    let actualEndpoint = endpoint;
    if (endpoint === '/activity') {
      actualEndpoint = '/admin/activity';
    } else if (endpoint === '/login') {
      actualEndpoint = '/auth/login';
    } else if (endpoint === '/me') {
      actualEndpoint = '/auth/me';
    } else if (endpoint === '/register') {
      actualEndpoint = '/auth/register';
    } else if (endpoint === '/change-password') {
      actualEndpoint = '/auth/change-password';
    } else if (endpoint === '/transfer') {
      actualEndpoint = '/transactions/transfer';
    } else if (endpoint === '/balance') {
      actualEndpoint = '/accounts/balance';
    } else if (endpoint === '/') {
      actualEndpoint = '/';
    }
    
    const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:3001';
    const fullUrl = `${apiUrl}/api${actualEndpoint}`;
    
    // Build the cURL command
    let curlCommand = `curl -X ${method} "${fullUrl}"`;
    
    // Add headers
    curlCommand += ` \\\n  -H "Content-Type: application/json"`;
    
    // Add authorization header if available
    if (selectedLog.authorization) {
      curlCommand += ` \\\n  -H "Authorization: ${selectedLog.authorization}"`;
    }
    
    // Add user agent if available
    if (selectedLog.userAgent) {
      curlCommand += ` \\\n  -H "User-Agent: ${selectedLog.userAgent}"`;
    }
    
    // Add request body if it exists
    if (selectedLog.requestBody && Object.keys(selectedLog.requestBody).length > 0) {
      const bodyJson = JSON.stringify(selectedLog.requestBody, null, 2);
      // Escape single quotes in the JSON for cURL command
      const escapedBody = bodyJson.replace(/'/g, "'\"'\"'");
      curlCommand += ` \\\n  -d '${escapedBody}'`;
    }
    
    // Copy to clipboard
    navigator.clipboard.writeText(curlCommand).then(() => {
      // Show a temporary success message
      const button = document.getElementById('copy-curl-btn');
      if (button) {
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        button.style.backgroundColor = '#10b981';
        setTimeout(() => {
          button.textContent = originalText;
          button.style.backgroundColor = '';
        }, 2000);
      }
      // Log the generated command for debugging
      console.log('Generated cURL command:', curlCommand);
    }).catch(err => {
      console.error('Failed to copy to clipboard:', err);
      // Fallback: show alert with the command
      alert('Copy failed. Here is the cURL command:\n\n' + curlCommand);
    });
  };

  if (loading && logs.length === 0) {
    return (
      <div className="loading">
        <div>Loading activity logs...</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ color: '#1e293b' }}>Activity Logs</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={exportLogs} className="btn btn-secondary">
            Export CSV
          </button>
          <button onClick={clearOldLogs} className="btn btn-danger">
            Clear Old Logs
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Filters</h2>
        </div>
        <div className="filters">
          <div className="filter-group">
            <label className="filter-label">Username</label>
            <input
              type="text"
              className="filter-input"
              value={filters.username}
              onChange={(e) => handleFilterChange('username', e.target.value)}
              placeholder="Filter by username"
            />
          </div>
          <div className="filter-group">
            <label className="filter-label">Action</label>
            <select
              className="filter-input"
              value={filters.action}
              onChange={(e) => handleFilterChange('action', e.target.value)}
            >
              <option value="">All Actions</option>
              <option value="LOGIN">Login</option>
              <option value="REGISTER">Register</option>
              <option value="TRANSFER_MONEY">Transfer Money</option>
              <option value="CHECK_BALANCE">Check Balance</option>
              <option value="GET_TRANSACTIONS">Get Transactions</option>
              <option value="CREATE_USER">Create User</option>
              <option value="UPDATE_USER">Update User</option>
              <option value="DELETE_USER">Delete User</option>
              <option value="ADMIN_ACCESS">Admin Access</option>
              <option value="VIEW_ACTIVITY_LOGS">View Activity Logs</option>
              <option value="API_ROOT">API Root</option>
              <option value="GET_CURRENT_USER">Get Current User</option>
              <option value="CREATE_ACCOUNT">Create Account</option>
              <option value="UPDATE_ACCOUNT">Update Account</option>
              <option value="DELETE_ACCOUNT">Delete Account</option>
              <option value="CREATE_TRANSACTION">Create Transaction</option>
              <option value="UPDATE_TRANSACTION">Update Transaction</option>
              <option value="DELETE_TRANSACTION">Delete Transaction</option>
              <option value="GET_USERS">Get Users</option>
              <option value="GET_ACCOUNTS">Get Accounts</option>
            </select>
          </div>
          <div className="filter-group">
            <label className="filter-label">Start Date</label>
            <input
              type="date"
              className="filter-input"
              value={filters.startDate}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
            />
          </div>
          <div className="filter-group">
            <label className="filter-label">End Date</label>
            <input
              type="date"
              className="filter-input"
              value={filters.endDate}
              onChange={(e) => handleFilterChange('endDate', e.target.value)}
            />
          </div>
          <div className="filter-group">
            <label className="filter-label">Limit</label>
            <select
              className="filter-input"
              value={filters.limit}
              onChange={(e) => handleFilterChange('limit', e.target.value)}
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
          <div className="filter-actions">
            <button
              className="btn btn-secondary"
              onClick={() => setFilters({
                page: 1,
                limit: 50,
                username: '',
                action: '',
                startDate: '',
                endDate: ''
              })}
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Activity Logs Table */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Activity Logs</h2>
          <span style={{ color: '#64748b', fontSize: '0.875rem' }}>
            Showing {logs.length} of {pagination.totalLogs} logs
          </span>
        </div>

        {logs.length > 0 ? (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Endpoint</th>
                  <th>IP Address</th>
                  <th>Status</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr 
                    key={log.id} 
                    onClick={() => handleRowClick(log)}
                    className="clickable"
                  >
                    <td>{format(new Date(log.timestamp), 'MMM dd, yyyy HH:mm:ss')}</td>
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
                    <td>{log.ipAddress || 'N/A'}</td>
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
                    <td>{log.duration}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No activity logs found</h3>
            <p>No activity logs match the current filters.</p>
          </div>
        )}

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="pagination">
            <button
              className="pagination-btn"
              onClick={() => handlePageChange(pagination.currentPage - 1)}
              disabled={pagination.currentPage === 1}
            >
              Previous
            </button>
            
            {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                className={`pagination-btn ${page === pagination.currentPage ? 'active' : ''}`}
                onClick={() => handlePageChange(page)}
              >
                {page}
              </button>
            ))}
            
            <button
              className="pagination-btn"
              onClick={() => handlePageChange(pagination.currentPage + 1)}
              disabled={pagination.currentPage === pagination.totalPages}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Log Details Modal */}
      {showModal && selectedLog && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Request Details</h2>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button 
                  id="copy-curl-btn"
                  className="btn btn-secondary" 
                  onClick={copyAsCurl}
                  style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}
                >
                  Copy as cURL
                </button>
                <button className="modal-close" onClick={closeModal}>×</button>
              </div>
            </div>
            <div className="modal-body">
              <div className="detail-section">
                <h3>Basic Information</h3>
                <div className="detail-grid">
                  <div className="detail-item">
                    <label>Timestamp:</label>
                    <span>{format(new Date(selectedLog.timestamp), 'MMM dd, yyyy HH:mm:ss')}</span>
                  </div>
                  <div className="detail-item">
                    <label>User:</label>
                    <span>{selectedLog.username || 'Unknown'}</span>
                  </div>
                  <div className="detail-item">
                    <label>Action:</label>
                    <span style={{
                      padding: '0.25rem 0.5rem',
                      borderRadius: '0.25rem',
                      fontSize: '0.75rem',
                      fontWeight: '500',
                      backgroundColor: getActionColor(selectedLog.action),
                      color: 'white'
                    }}>
                      {selectedLog.action}
                    </span>
                  </div>
                  <div className="detail-item">
                    <label>Endpoint:</label>
                    <span style={{ fontFamily: 'monospace' }}>{selectedLog.endpoint}</span>
                  </div>
                  <div className="detail-item">
                    <label>IP Address:</label>
                    <span>{selectedLog.ipAddress || 'N/A'}</span>
                  </div>
                  <div className="detail-item">
                    <label>Status:</label>
                    <span style={{
                      padding: '0.25rem 0.5rem',
                      borderRadius: '0.25rem',
                      fontSize: '0.75rem',
                      fontWeight: '500',
                      backgroundColor: selectedLog.responseStatus >= 400 ? '#ef4444' : '#10b981',
                      color: 'white'
                    }}>
                      {selectedLog.responseStatus}
                    </span>
                  </div>
                  <div className="detail-item">
                    <label>Duration:</label>
                    <span>{selectedLog.duration}ms</span>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h3>Request Headers</h3>
                <div className="code-block">
                  <pre>{JSON.stringify({
                    'User-Agent': selectedLog.userAgent,
                    'Content-Type': 'application/json',
                    'Authorization': selectedLog.username ? 'Bearer [TOKEN]' : 'None'
                  }, null, 2)}</pre>
                </div>
              </div>

              {selectedLog.requestBody && (
                <div className="detail-section">
                  <h3>Request Body</h3>
                  <div className="code-block">
                    <pre>{JSON.stringify(selectedLog.requestBody, null, 2)}</pre>
                  </div>
                </div>
              )}

              <div className="detail-section">
                <h3>Response Information</h3>
                <div className="detail-grid">
                  <div className="detail-item">
                    <label>Status Code:</label>
                    <span style={{
                      padding: '0.25rem 0.5rem',
                      borderRadius: '0.25rem',
                      fontSize: '0.75rem',
                      fontWeight: '500',
                      backgroundColor: selectedLog.responseStatus >= 400 ? '#ef4444' : '#10b981',
                      color: 'white'
                    }}>
                      {selectedLog.responseStatus}
                    </span>
                  </div>
                  <div className="detail-item">
                    <label>Response Time:</label>
                    <span>{selectedLog.duration}ms</span>
                  </div>
                </div>
              </div>

              {selectedLog.responseBody && (
                <div className="detail-section">
                  <h3>Response Body</h3>
                  <div className="code-block">
                    <pre>{JSON.stringify(selectedLog.responseBody, null, 2)}</pre>
                  </div>
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
    'VIEW_ACTIVITY_LOGS': '#ec4899',
    'API_ROOT': '#8b5cf6',
    'GET_CURRENT_USER': '#06b6d4'
  };
  
  return colors[action] || '#6b7280';
};

export default ActivityLogs;
