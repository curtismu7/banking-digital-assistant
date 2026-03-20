import React, { useState, useEffect } from 'react';
import './AuthorizationModal.css';

const AuthorizationModal = ({ 
  isOpen, 
  onClose, 
  authorizationUrl, 
  onAuthorizationComplete,
  onAuthorizationError 
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsLoading(false);
    }
  }, [isOpen]);

  const handleAuthorize = () => {
    if (!authorizationUrl) {
      setError('No authorization URL provided');
      return;
    }

    setIsLoading(true);
    setError(null);

    // Open authorization URL in a new window
    const authWindow = window.open(
      authorizationUrl,
      'oauth-authorization',
      'width=600,height=700,scrollbars=yes,resizable=yes'
    );

    if (!authWindow) {
      setError('Failed to open authorization window. Please check your popup blocker settings.');
      setIsLoading(false);
      return;
    }

    // Poll for window closure or message
    const pollTimer = setInterval(() => {
      try {
        if (authWindow.closed) {
          clearInterval(pollTimer);
          setIsLoading(false);
          setError('Authorization was cancelled');
          if (onAuthorizationError) {
            onAuthorizationError(new Error('Authorization cancelled'));
          }
        }
      } catch (e) {
        // Cross-origin error when trying to access closed window
        // This is expected and can be ignored
      }
    }, 1000);

    // Listen for messages from the authorization window
    const messageHandler = (event) => {
      // Verify origin for security
      if (event.origin !== window.location.origin) {
        return;
      }

      if (event.data.type === 'OAUTH_SUCCESS') {
        clearInterval(pollTimer);
        setIsLoading(false);
        authWindow.close();
        window.removeEventListener('message', messageHandler);
        
        if (onAuthorizationComplete) {
          onAuthorizationComplete(event.data.code, event.data.state);
        }
        onClose();
      } else if (event.data.type === 'OAUTH_ERROR') {
        clearInterval(pollTimer);
        setIsLoading(false);
        authWindow.close();
        window.removeEventListener('message', messageHandler);
        
        const error = new Error(event.data.error || 'Authorization failed');
        setError(error.message);
        if (onAuthorizationError) {
          onAuthorizationError(error);
        }
      }
    };

    window.addEventListener('message', messageHandler);

    // Cleanup function
    return () => {
      clearInterval(pollTimer);
      window.removeEventListener('message', messageHandler);
      if (authWindow && !authWindow.closed) {
        authWindow.close();
      }
    };
  };

  const handleCancel = () => {
    setError(null);
    setIsLoading(false);
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="authorization-modal-overlay">
      <div className="authorization-modal">
        <div className="authorization-modal-header">
          <h2>Authorization Required</h2>
          <button 
            className="close-button" 
            onClick={handleCancel}
            disabled={isLoading}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        
        <div className="authorization-modal-content">
          <p>
            The agent needs your permission to access external resources. 
            Click "Authorize" to open the authorization page in a new window.
          </p>
          
          {error && (
            <div className="error-message">
              <strong>Error:</strong> {error}
            </div>
          )}
          
          <div className="authorization-modal-actions">
            <button
              className="authorize-button"
              onClick={handleAuthorize}
              disabled={isLoading || !authorizationUrl}
            >
              {isLoading ? 'Authorizing...' : 'Authorize'}
            </button>
            <button
              className="cancel-button"
              onClick={handleCancel}
              disabled={isLoading}
            >
              Cancel
            </button>
          </div>
          
          {isLoading && (
            <div className="loading-info">
              <p>Please complete the authorization in the popup window.</p>
              <p>This window will close automatically when authorization is complete.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthorizationModal;