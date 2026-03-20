import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import apiClient from '../services/apiClient';

const Users = ({ user, onLogout }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/api/users');
      setUsers(response.data.users);
    } catch (error) {
      console.error('Users error:', error);
      
      if (error.response?.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else if (error.response?.status === 403) {
        setError('You do not have permission to view users.');
      } else {
        setError('Failed to load users');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      fetchUsers();
      return;
    }

    try {
      setLoading(true);
      const response = await apiClient.get(`/api/users/search/${searchQuery}`);
      setUsers(response.data.users);
    } catch (error) {
      console.error('Search error:', error);
      
      if (error.response?.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else if (error.response?.status === 403) {
        setError('You do not have permission to search users.');
      } else {
        setError('Failed to search users');
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleUserStatus = async (userId, currentStatus) => {
    try {
      await apiClient.put(`/api/users/${userId}`, {
        isActive: !currentStatus
      });
      fetchUsers(); // Refresh the list
    } catch (error) {
      console.error('Toggle status error:', error);
      
      if (error.response?.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else if (error.response?.status === 403) {
        setError('You do not have permission to update user status.');
      } else {
        setError('Failed to update user status');
      }
    }
  };

  const deleteUser = async (userId, userName) => {
    if (!window.confirm(`Are you sure you want to delete user "${userName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await apiClient.delete(`/api/users/${userId}`);
      setError(''); // Clear any previous errors
      fetchUsers(); // Refresh the list
    } catch (error) {
      console.error('Delete user error:', error);
      
      if (error.response?.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else if (error.response?.status === 403) {
        setError('You do not have permission to delete users.');
      } else {
        const errorMessage = error.response?.data?.error || 'Failed to delete user';
        setError(errorMessage);
      }
    }
  };

  if (loading && users.length === 0) {
    return (
      <div className="loading">
        <div>Loading users...</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ color: '#1e293b' }}>Users</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '200px' }}
            />
            <button onClick={handleSearch} className="btn btn-primary">
              Search
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">User Management</h2>
          <span style={{ color: '#64748b', fontSize: '0.875rem' }}>
            {users.length} users found
          </span>
        </div>

        {users.length > 0 ? (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.firstName} {user.lastName}</td>
                    <td>{user.username}</td>
                    <td>{user.email}</td>
                    <td>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: '500',
                        backgroundColor: user.role === 'admin' ? '#ef4444' : '#10b981',
                        color: 'white'
                      }}>
                        {user.role}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: '500',
                        backgroundColor: user.isActive ? '#10b981' : '#6b7280',
                        color: 'white'
                      }}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>{format(new Date(user.createdAt), 'MMM dd, yyyy')}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => toggleUserStatus(user.id, user.isActive)}
                          className={`btn ${user.isActive ? 'btn-danger' : 'btn-success'}`}
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                        >
                          {user.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          onClick={() => deleteUser(user.id, `${user.firstName} ${user.lastName}`)}
                          className="btn btn-danger"
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                          title="Delete user"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No users found</h3>
            <p>No users match the current search criteria.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Users;
