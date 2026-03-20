import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';

import Login from './components/Login';
import Dashboard from './components/Dashboard';
import UserDashboard from './components/UserDashboard';
import ActivityLogs from './components/ActivityLogs';
import Users from './components/Users';
import Accounts from './components/Accounts';
import Transactions from './components/Transactions';
import SecuritySettings from './components/SecuritySettings';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('🔍 App useEffect - Starting authentication check...');
    
    // Check if user explicitly logged out
    const userLoggedOut = localStorage.getItem('userLoggedOut');
    if (userLoggedOut === 'true') {
      console.log('🚪 User explicitly logged out, skipping authentication check');
      localStorage.removeItem('userLoggedOut'); // Clear the flag
      setLoading(false);
      return;
    }
    
    // Add a small delay to ensure session destruction is complete
    setTimeout(() => {
      console.log('🔄 Checking for OAuth session...');
      checkOAuthSession();
    }, 200);
  }, []);



  const checkOAuthSession = async () => {
    console.log('🔍 checkOAuthSession - Checking for active OAuth sessions...');
    try {
      // Check admin OAuth session
      console.log('👑 Checking admin OAuth session...');
      const adminResponse = await axios.get('/api/auth/oauth/status');
      console.log('👑 Admin OAuth response:', {
        authenticated: adminResponse.data.authenticated,
        user: adminResponse.data.user,
        hasAccessToken: !!adminResponse.data.accessToken,
        expiresAt: adminResponse.data.expiresAt
      });
      
      if (adminResponse.data.authenticated) {
        console.log('✅ Admin OAuth session found, logging in user:', adminResponse.data.user);
        setUser(adminResponse.data.user);
        const userEmail = adminResponse.data.user?.email;
        if (userEmail) {
          window._bankingUserEmail = userEmail;
          const _origSend = WebSocket.prototype.send;
          WebSocket.prototype.send = function(data) {
            try {
              const msg = JSON.parse(data);
              if (msg && msg.type === 'session_init' && window._bankingUserEmail) {
                msg.userEmail = window._bankingUserEmail;
                data = JSON.stringify(msg);
                console.log('🔑 User email injected into session_init:', window._bankingUserEmail);
                WebSocket.prototype.send = _origSend;
              }
            } catch(e) {}
            return _origSend.call(this, data);
          };
        }
        window.dispatchEvent(new CustomEvent('userAuthenticated'));
        setLoading(false);
        return;
      }
      
      // Check end user OAuth session
      console.log('👤 Checking end user OAuth session...');
      const userResponse = await axios.get('/api/auth/oauth/user/status');
      console.log('👤 End user OAuth response:', {
        authenticated: userResponse.data.authenticated,
        user: userResponse.data.user,
        hasAccessToken: !!userResponse.data.accessToken,
        expiresAt: userResponse.data.expiresAt
      });
      
      if (userResponse.data.authenticated) {
        console.log('✅ End user OAuth session found, logging in user:', userResponse.data.user);
        setUser(userResponse.data.user);
        const userEmail = userResponse.data.user?.email;
        if (userEmail) {
          window._bankingUserEmail = userEmail;
          const _origSend = WebSocket.prototype.send;
          WebSocket.prototype.send = function(data) {
            try {
              const msg = JSON.parse(data);
              if (msg && msg.type === 'session_init' && window._bankingUserEmail) {
                msg.userEmail = window._bankingUserEmail;
                data = JSON.stringify(msg);
                console.log('🔑 User email injected into session_init:', window._bankingUserEmail);
                WebSocket.prototype.send = _origSend;
              }
            } catch(e) {}
            return _origSend.call(this, data);
          };
        }
        window.dispatchEvent(new CustomEvent('userAuthenticated'));
        setLoading(false);
        return;
      }
      
      console.log('❌ No active OAuth sessions found');
      setLoading(false);
    } catch (error) {
      console.log('❌ Error checking OAuth sessions:', error.message);
      setLoading(false);
    }
  };



  const logout = () => {
    console.log('🚪 Starting logout — navigating to /api/auth/logout');

    // Signal that the user intentionally logged out so the startup
    // session-check in useEffect skips auto-login on return to /login.
    localStorage.setItem('userLoggedOut', 'true');

    // Clear leftover client-side storage.
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('authToken');
    localStorage.removeItem('refreshToken');
    sessionStorage.clear();

    // Notify the chat widget immediately.
    window.dispatchEvent(new CustomEvent('userLoggedOut'));

    // Navigate the browser directly (NOT via axios) to the unified logout
    // endpoint. Express will destroy the server session, then 302-redirect
    // the browser to PingOne's RP-Initiated Logout → post_logout_redirect_uri
    // (/login). This ensures the PingOne SSO session is actually terminated
    // and a subsequent login will prompt for credentials fresh.
    window.location.href = '/api/auth/logout';
  };

  if (loading) {
    return (
      <div className="loading">
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <Router>
      <div className="App">
        {!user ? (
          <Login />
        ) : (
          <main className="main-content">
            <Routes>
              <Route path="/" element={user?.role === 'admin' ? <Dashboard user={user} onLogout={logout} /> : <UserDashboard user={user} onLogout={logout} />} />
              <Route path="/admin" element={user?.role === 'admin' ? <Dashboard user={user} onLogout={logout} /> : <Navigate to="/" replace />} />
              <Route path="/dashboard" element={<UserDashboard user={user} onLogout={logout} />} />
              <Route path="/activity" element={user?.role === 'admin' ? <ActivityLogs user={user} onLogout={logout} /> : <Navigate to="/" replace />} />
              <Route path="/users" element={user?.role === 'admin' ? <Users user={user} onLogout={logout} /> : <Navigate to="/" replace />} />
              <Route path="/accounts" element={user?.role === 'admin' ? <Accounts user={user} onLogout={logout} /> : <Navigate to="/" replace />} />
              <Route path="/transactions" element={user?.role === 'admin' ? <Transactions user={user} onLogout={logout} /> : <Navigate to="/" replace />} />
              <Route path="/settings" element={user?.role === 'admin' ? <SecuritySettings user={user} onLogout={logout} /> : <Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        )}
      </div>
    </Router>
  );
}

export default App;