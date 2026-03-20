import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const Login = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const handleOAuthLogin = () => {
    // Redirect to OAuth login endpoint on the backend server
    const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:3001';
    const clientUrl = process.env.REACT_APP_CLIENT_URL || 'http://localhost:3000';
    window.location.href = `${apiUrl}/api/auth/oauth/login?redirect_uri=${encodeURIComponent(clientUrl + '/admin')}`;
  };

  const handleUserOAuthLogin = () => {
    // Redirect to end user OAuth login endpoint
    const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:3001';
    const clientUrl = process.env.REACT_APP_CLIENT_URL || 'http://localhost:3000';
    window.location.href = `${apiUrl}/api/auth/oauth/user/login?redirect_uri=${encodeURIComponent(clientUrl + '/dashboard')}`;
  };

  // Handle OAuth error parameters from URL
  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      let errorMessage = '';
      switch (errorParam) {
        case 'oauth_error':
          errorMessage = 'OAuth authentication failed. Please try again.';
          break;
        case 'invalid_state':
          errorMessage = 'Invalid authentication state. Please try again.';
          break;
        case 'no_code':
          errorMessage = 'No authorization code received. Please try again.';
          break;
        case 'callback_failed':
          errorMessage = 'Authentication callback failed. Please try again.';
          break;
        case 'oauth_init_failed':
          errorMessage = 'Failed to initialize OAuth. Please try again.';
          break;
        default:
          errorMessage = 'Authentication error occurred. Please try again.';
      }
      setError(errorMessage);
    }
  }, [searchParams]);

  const loginContainerStyle = {
    background: `url(${process.env.PUBLIC_URL}/images/pexels-1462751220-33995750.jpg)`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'fixed',
    backgroundRepeat: 'no-repeat'
  };

  return (
    <div className="login-container" style={loginContainerStyle}>
        <div className="login-card">
          <div className="login-header">
            <div className="login-branding">
              <div className="login-logo">
                <div className="logo-icon">
                  <div className="logo-square"></div>
                  <div className="logo-square"></div>
                  <div className="logo-square"></div>
                  <div className="logo-square"></div>
                </div>
                <span className="bank-name">BX Finance</span>
              </div>
            </div>
            <h1>Secure Account Access</h1>
            <p>Sign in to access your banking services</p>
          </div>

          {error && (
            <div className="alert alert-error">
              {error}
            </div>
          )}

          <div className="oauth-login">
            <div className="oauth-options">
              <div className="oauth-option">
                <h4>Admin Access</h4>
                <p>Access the admin panel with full system privileges</p>
                <button
                  onClick={handleOAuthLogin}
                  className="btn btn-primary oauth-btn"
                  disabled={loading}
                >
                  {loading ? 'Redirecting...' : 'Admin Sign in with P1AIC'}
                </button>
              </div>

              <div className="oauth-divider">
                <span>or</span>
              </div>

              <div className="oauth-option">
                <h4>End User Access</h4>
                <p>Access your personal account dashboard</p>
                <button
                  onClick={handleUserOAuthLogin}
                  className="btn btn-danger oauth-btn"
                  disabled={loading}
                >
                  {loading ? 'Redirecting...' : 'Customer Sign in with P1AIC'}
                </button>
              </div>
            </div>
          </div>

          <div className="login-footer">
            <p>
              <strong>P1AIC OAuth Authentication</strong><br />
              Secure enterprise-grade authentication powered by PingOne Advanced Identity Cloud
            </p>
          </div>
        </div>
      </div>
  );
};

export default Login;
