import axios from 'axios';

class ApiClient {
  constructor() {
    this.client = axios.create({
      baseURL: process.env.REACT_APP_API_URL || '',
      timeout: 10000,
    });

    this.setupInterceptors();
  }

  setupInterceptors() {
    // Request interceptor to add OAuth token
    this.client.interceptors.request.use(
      async (config) => {
        const token = await this.getValidToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor to handle token expiration
    this.client.interceptors.response.use(
      (response) => {
        return response;
      },
      async (error) => {
        const originalRequest = error.config;

        // Check if error is due to token expiration (401) and we haven't already tried to refresh
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            // Try to refresh the token
            const newToken = await this.refreshToken();
            if (newToken) {
              // Update the authorization header and retry the request
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
              return this.client(originalRequest);
            }
          } catch (refreshError) {
            console.error('Token refresh failed:', refreshError);
            
            // Only redirect to login if refresh is not implemented or no refresh token
            // This prevents unnecessary redirects during development
            if (refreshError.response?.status === 501 || refreshError.response?.status === 401) {
              console.log('Token refresh not available, redirecting to login');
              this.handleAuthFailure();
            }
            
            return Promise.reject(refreshError);
          }
        }

        // Check for insufficient scope errors (403)
        if (error.response?.status === 403) {
          console.error('Insufficient scope for request:', error.response.data);
          
          // Add more detailed error information for scope issues
          if (error.response.data?.error === 'insufficient_scope') {
            const scopeError = new Error('Insufficient permissions for this operation');
            scopeError.response = error.response;
            scopeError.requiredScopes = error.response.data?.required_scopes;
            scopeError.providedScopes = error.response.data?.provided_scopes;
            return Promise.reject(scopeError);
          }
        }

        return Promise.reject(error);
      }
    );
  }

  async getValidToken() {
    try {
      // First try to get token from current session
      const sessionToken = await this.getTokenFromSession();
      if (sessionToken && !this.isTokenExpired(sessionToken)) {
        return sessionToken;
      }

      // If token is expired or not available, try to refresh
      if (sessionToken) {
        const refreshedToken = await this.refreshToken();
        if (refreshedToken) {
          return refreshedToken;
        }
      }

      return null;
    } catch (error) {
      console.error('Error getting valid token:', error);
      return null;
    }
  }

  async getTokenFromSession() {
    try {
      // Try end user OAuth session first
      const userResponse = await axios.get('/api/auth/oauth/user/status');
      if (userResponse.data.authenticated && userResponse.data.accessToken) {
        return userResponse.data.accessToken;
      }

      // Try admin OAuth session as fallback
      const adminResponse = await axios.get('/api/auth/oauth/status');
      if (adminResponse.data.authenticated && adminResponse.data.accessToken) {
        return adminResponse.data.accessToken;
      }

      return null;
    } catch (error) {
      console.error('Error getting token from session:', error);
      return null;
    }
  }

  isTokenExpired(token) {
    try {
      // For OAuth tokens, we can't decode them like JWTs
      // Instead, we'll rely on the server to tell us if they're expired
      // This is a placeholder - in a real implementation, you might want to
      // check the token's expiration time if available from the session status
      return false;
    } catch (error) {
      console.error('Error checking token expiration:', error);
      return true;
    }
  }

  async refreshToken() {
    try {
      // Try to refresh the end user token first
      try {
        const userRefreshResponse = await axios.post('/api/auth/oauth/user/refresh');
        if (userRefreshResponse.data.accessToken) {
          console.log('Successfully refreshed end user token');
          return userRefreshResponse.data.accessToken;
        }
      } catch (userRefreshError) {
        console.log('End user token refresh failed:', userRefreshError.response?.data?.error || userRefreshError.message);
        
        // If refresh is not implemented (501) or no refresh token (401), don't try admin refresh
        if (userRefreshError.response?.status === 501 || userRefreshError.response?.status === 401) {
          throw userRefreshError;
        }
      }

      // Try to refresh the admin token
      try {
        const adminRefreshResponse = await axios.post('/api/auth/oauth/refresh');
        if (adminRefreshResponse.data.accessToken) {
          console.log('Successfully refreshed admin token');
          return adminRefreshResponse.data.accessToken;
        }
      } catch (adminRefreshError) {
        console.log('Admin token refresh failed:', adminRefreshError.response?.data?.error || adminRefreshError.message);
        throw adminRefreshError;
      }

      throw new Error('All token refresh attempts failed');
    } catch (error) {
      console.error('Token refresh failed:', error);
      
      // If refresh is not implemented or no refresh token available, handle gracefully
      if (error.response?.status === 501) {
        console.log('Token refresh not implemented, will redirect to login');
      } else if (error.response?.status === 401) {
        console.log('No refresh token available, will redirect to login');
      }
      
      throw error;
    }
  }

  handleAuthFailure() {
    console.log('Authentication failed, redirecting to login');
    
    // Set logout flag to prevent auto-login attempts
    localStorage.setItem('userLoggedOut', 'true');
    
    // Clear any cached tokens
    delete axios.defaults.headers.common['Authorization'];
    
    // Dispatch logout event for other components
    window.dispatchEvent(new CustomEvent('userLoggedOut'));
    
    // Redirect to login
    setTimeout(() => {
      window.location.href = '/';
    }, 100);
  }

  // Convenience methods that use the configured client
  get(url, config) {
    return this.client.get(url, config);
  }

  post(url, data, config) {
    return this.client.post(url, data, config);
  }

  put(url, data, config) {
    return this.client.put(url, data, config);
  }

  delete(url, config) {
    return this.client.delete(url, config);
  }

  patch(url, data, config) {
    return this.client.patch(url, data, config);
  }
}

// Create and export a singleton instance
const apiClient = new ApiClient();
export default apiClient;