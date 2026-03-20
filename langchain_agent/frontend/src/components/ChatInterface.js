import React, { useState, useEffect, useRef } from 'react';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import AuthorizationModal from './AuthorizationModal';
import { useWebSocket } from '../hooks/useWebSocket';
import './ChatInterface.css';

const ChatInterface = ({ apiUrl, onDashboardRefresh }) => {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [authModal, setAuthModal] = useState({
    isOpen: false,
    authorizationUrl: null,
    requestId: null
  });
  const messagesEndRef = useRef(null);
  const { 
    connectionState, 
    isConnected, 
    lastMessage, 
    error, 
    sendMessage, 
    reconnect
  } = useWebSocket(apiUrl);

  const scrollToBottom = () => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Helper function to detect banking operations and trigger dashboard refresh
  const detectAndRefreshDashboard = (messageContent) => {
    if (!onDashboardRefresh) return;

    try {
      // Check for transfer success messages
      if (messageContent.includes('Transfer Successful') || messageContent.includes('✅ **Transfer Successful**')) {
        // Extract transfer details from formatted message
        const amountMatch = messageContent.match(/Amount:\s*\*?\*?\$?([\d,]+\.?\d*)/i);
        const fromAccountMatch = messageContent.match(/From Account:\s*([a-f0-9-]+)/i);
        const toAccountMatch = messageContent.match(/To Account:\s*([a-f0-9-]+)/i);
        const withdrawalIdMatch = messageContent.match(/Withdrawal ID:\s*([a-f0-9-]+)/i);
        
        onDashboardRefresh('transaction_completed', {
          type: 'transfer',
          amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null,
          fromAccountId: fromAccountMatch ? fromAccountMatch[1] : null,
          toAccountId: toAccountMatch ? toAccountMatch[1] : null,
          transactionId: withdrawalIdMatch ? withdrawalIdMatch[1] : null,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Check for deposit success messages
      if (messageContent.includes('Deposit Successful') || messageContent.includes('✅ **Deposit Successful**')) {
        const amountMatch = messageContent.match(/Amount:\s*\*?\*?\$?([\d,]+\.?\d*)/i);
        const accountMatch = messageContent.match(/Account:\s*([a-f0-9-]+)/i);
        const transactionIdMatch = messageContent.match(/Transaction ID:\s*([a-f0-9-]+)/i);
        const newBalanceMatch = messageContent.match(/New Balance:\s*\*?\*?\$?([\d,]+\.?\d*)/i);
        
        onDashboardRefresh('transaction_completed', {
          type: 'deposit',
          amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null,
          accountId: accountMatch ? accountMatch[1] : null,
          transactionId: transactionIdMatch ? transactionIdMatch[1] : null,
          newBalance: newBalanceMatch ? parseFloat(newBalanceMatch[1].replace(/,/g, '')) : null,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Check for withdrawal success messages
      if (messageContent.includes('Withdrawal Successful') || messageContent.includes('✅ **Withdrawal Successful**')) {
        const amountMatch = messageContent.match(/Amount:\s*\*?\*?\$?([\d,]+\.?\d*)/i);
        const accountMatch = messageContent.match(/Account:\s*([a-f0-9-]+)/i);
        const transactionIdMatch = messageContent.match(/Transaction ID:\s*([a-f0-9-]+)/i);
        const newBalanceMatch = messageContent.match(/New Balance:\s*\*?\*?\$?([\d,]+\.?\d*)/i);
        
        onDashboardRefresh('transaction_completed', {
          type: 'withdrawal',
          amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null,
          accountId: accountMatch ? accountMatch[1] : null,
          transactionId: transactionIdMatch ? transactionIdMatch[1] : null,
          newBalance: newBalanceMatch ? parseFloat(newBalanceMatch[1].replace(/,/g, '')) : null,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Check for account balance information
      if (messageContent.includes('Your Bank Accounts') || messageContent.includes('💰 **Your Bank Accounts**')) {
        onDashboardRefresh('accounts_updated', {
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Check for account registration completion
      if (messageContent.includes('account registration is now complete') || messageContent.includes('registration completed')) {
        onDashboardRefresh('account_registered', {
          timestamp: new Date().toISOString()
        });
        return;
      }

    } catch (error) {
      console.error('Error detecting banking operations for dashboard refresh:', error);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handle incoming WebSocket messages
  useEffect(() => {
    if (lastMessage) {
      if (lastMessage.type === 'chat_response') {
        const agentMessage = {
          id: Date.now().toString(),
          content: lastMessage.content,
          role: 'assistant',
          timestamp: lastMessage.timestamp || new Date().toISOString(),
          metadata: lastMessage.metadata || {}
        };
        setMessages(prev => [...prev, agentMessage]);
        setIsLoading(false);
        
        // Check if this message indicates a banking operation that should refresh the dashboard
        detectAndRefreshDashboard(lastMessage.content);
      } else if (lastMessage.type === 'authorization_required') {
        // Handle authorization request
        setAuthModal({
          isOpen: true,
          authorizationUrl: lastMessage.data.authorization_url,
          requestId: lastMessage.data.request_id
        });
        setIsLoading(false);
      } else if (lastMessage.type === 'error') {
        console.error('WebSocket error:', lastMessage);
        setIsLoading(false);
        // Add error message to chat
        const errorMessage = {
          id: Date.now().toString(),
          content: `Error: ${lastMessage.error_message || 'An error occurred'}`,
          role: 'assistant',
          timestamp: new Date().toISOString(),
          metadata: { error: true }
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    }
  }, [lastMessage]);

  const handleSendMessage = async (messageContent) => {
    if (!messageContent.trim() || !isConnected) return;

    const userMessage = {
      id: Date.now().toString(),
      content: messageContent,
      role: 'user',
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    // Send message via WebSocket
    const success = sendMessage(messageContent);
    
    if (!success) {
      setIsLoading(false);
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        content: 'Failed to send message. Please check your connection.',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        metadata: { error: true }
      };
      setMessages(prev => [...prev, errorMessage]);
    }
  };

  const handleAuthorizationComplete = (authorizationCode) => {
    console.log('=== AUTHORIZATION COMPLETE ===');
    console.log('Authorization code received:', authorizationCode);
    console.log('Is connected:', isConnected);
    
    // Send authorization code back to the server as a regular message
    if (authorizationCode && isConnected) {
      console.log('Sending authorization code to backend...');
      
      // Add a message to the chat indicating authorization was completed
      const authCompleteMessage = {
        id: Date.now().toString(),
        content: 'Authorization completed successfully. Processing your request...',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        metadata: { system: true }
      };
      setMessages(prev => [...prev, authCompleteMessage]);
      
      // Send the authorization code as a regular message
      // The backend will detect it and process it automatically
      setIsLoading(true);
      const success = sendMessage(authorizationCode);
      console.log('Message send result:', success);
    } else {
      console.log('Cannot send authorization code - missing code or not connected');
    }
    console.log('=== END AUTHORIZATION COMPLETE ===');
  };

  const handleAuthorizationError = (error) => {
    console.error('Authorization error:', error);
    
    // Add error message to chat
    const errorMessage = {
      id: Date.now().toString(),
      content: `Authorization failed: ${error.message}`,
      role: 'assistant',
      timestamp: new Date().toISOString(),
      metadata: { error: true }
    };
    setMessages(prev => [...prev, errorMessage]);
    
    // Close the modal
    setAuthModal({
      isOpen: false,
      authorizationUrl: null,
      requestId: null
    });
  };

  const handleAuthorizationCancel = () => {
    // Add cancellation message to chat
    const cancelMessage = {
      id: Date.now().toString(),
      content: 'Authorization was cancelled. Some features may not be available.',
      role: 'assistant',
      timestamp: new Date().toISOString(),
      metadata: { warning: true }
    };
    setMessages(prev => [...prev, cancelMessage]);
    
    // Close the modal
    setAuthModal({
      isOpen: false,
      authorizationUrl: null,
      requestId: null
    });
  };

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <div className="connection-status">
          <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}></span>
          <span className="status-text">
            {connectionState === 'connecting' ? 'Connecting...' : 
             connectionState === 'connected' ? 'Connected' : 
             'Disconnected'}
          </span>
          {error && (
            <span className="error-text">
              {error}
            </span>
          )}
          {!isConnected && connectionState !== 'connecting' && (
            <button className="reconnect-button" onClick={reconnect}>
              Reconnect
            </button>
          )}
        </div>
      </div>
      
      <div className="chat-messages">
        <MessageList 
          messages={messages} 
          isLoading={isLoading}
          onAuthorizationComplete={handleAuthorizationComplete}
        />
        <div ref={messagesEndRef} />
      </div>
      
      <div className="chat-input">
        <MessageInput 
          onSendMessage={handleSendMessage}
          disabled={!isConnected || isLoading}
        />
      </div>

      <AuthorizationModal
        isOpen={authModal.isOpen}
        authorizationUrl={authModal.authorizationUrl}
        onClose={handleAuthorizationCancel}
        onAuthorizationComplete={handleAuthorizationComplete}
        onAuthorizationError={handleAuthorizationError}
      />
    </div>
  );
};

export default ChatInterface;