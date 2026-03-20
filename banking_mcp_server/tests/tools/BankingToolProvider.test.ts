/**
 * Banking Tool Provider Tests
 */

import { BankingToolProvider } from '../../src/tools/BankingToolProvider';
import { BankingAPIClient } from '../../src/banking/BankingAPIClient';
import { BankingAuthenticationManager } from '../../src/auth/BankingAuthenticationManager';
import { BankingSessionManager } from '../../src/storage/BankingSessionManager';
import { Session, UserTokens, AuthErrorCodes, AuthenticationError } from '../../src/interfaces/auth';
import { Account, Transaction, TransactionResponse, BankingAPIError } from '../../src/interfaces/banking';

// Mock dependencies
jest.mock('../../src/banking/BankingAPIClient');
jest.mock('../../src/auth/BankingAuthenticationManager');
jest.mock('../../src/storage/BankingSessionManager');

describe('BankingToolProvider', () => {
  let provider: BankingToolProvider;
  let mockApiClient: jest.Mocked<BankingAPIClient>;
  let mockAuthManager: jest.Mocked<BankingAuthenticationManager>;
  let mockSessionManager: jest.Mocked<BankingSessionManager>;
  let mockSession: Session;

  beforeEach(() => {
    mockApiClient = new BankingAPIClient() as jest.Mocked<BankingAPIClient>;
    mockAuthManager = new BankingAuthenticationManager({} as any) as jest.Mocked<BankingAuthenticationManager>;
    mockSessionManager = new BankingSessionManager('test', 'test-key') as jest.Mocked<BankingSessionManager>;
    
    // Set up default mocks for AuthenticationManager
    mockAuthManager.generateAuthorizationRequest = jest.fn();
    mockAuthManager.isTokenExpired = jest.fn();
    mockAuthManager.validateBankingScopes = jest.fn();
    
    provider = new BankingToolProvider(mockApiClient, mockAuthManager, mockSessionManager);

    // Create mock session with valid user tokens
    const mockUserTokens: UserTokens = {
      accessToken: 'valid_access_token',
      refreshToken: 'valid_refresh_token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: 'banking:accounts:read banking:transactions:read banking:transactions:write',
      issuedAt: new Date()
    };

    mockSession = {
      sessionId: 'session_123',
      agentTokenHash: 'agent_hash',
      userTokens: mockUserTokens,
      createdAt: new Date(),
      lastActivity: new Date(),
      expiresAt: new Date(Date.now() + 3600000)
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Helper function to mock successful authorization
  const mockSuccessfulAuthorization = () => {
    mockAuthManager.isTokenExpired.mockReturnValue(false);
    mockAuthManager.validateBankingScopes.mockReturnValue(true);
    mockAuthManager.generateAuthorizationRequest.mockReturnValue({
      authorizationUrl: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize',
      state: 'test-state',
      scope: 'banking:accounts:read',
      sessionId: 'session_123',
      expiresAt: new Date(Date.now() + 300000)
    });
  };

  describe('getAvailableTools', () => {
    it('should return all banking tools', () => {
      const tools = provider.getAvailableTools();
      
      expect(tools).toHaveLength(7);
      expect(tools.map(t => t.name)).toEqual([
        'get_my_accounts',
        'get_account_balance',
        'get_my_transactions',
        'create_deposit',
        'create_withdrawal',
        'create_transfer',
        'query_user_by_email'
      ]);
    });
  });

  describe('executeTool', () => {
    describe('parameter validation', () => {
      it('should reject unknown tool', async () => {
        const result = await provider.executeTool('unknown_tool', {}, mockSession);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('Unknown tool: unknown_tool');
        expect(result.text).toContain('Unknown tool: unknown_tool');
      });

      it('should reject invalid parameters', async () => {
        const result = await provider.executeTool('get_account_balance', {}, mockSession);
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid parameters');
        expect(result.text).toContain('Missing required parameter: account_id');
      });

      it('should accept valid parameters', async () => {
        const mockAccounts: Account[] = [
          {
            id: 'acc_123',
            userId: 'user_123',
            accountType: 'checking',
            accountNumber: '1234567890',
            balance: 1000.50,
            status: 'active',
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z'
          }
        ];

        mockSuccessfulAuthorization();
        mockApiClient.getMyAccounts.mockResolvedValue(mockAccounts);

        const result = await provider.executeTool('get_my_accounts', {}, mockSession);
        
        expect(result.success).toBe(true);
        expect(result.text).toContain('Found 1 account(s)');
        expect(mockApiClient.getMyAccounts).toHaveBeenCalledWith('valid_access_token');
      });
    });

    describe('authorization handling', () => {
      it('should require user authorization when no user tokens', async () => {
        const sessionWithoutTokens = { ...mockSession, userTokens: undefined };
        const mockAuthRequest = {
          authorizationUrl: 'https://auth.example.com/authorize',
          state: 'state_123',
          scope: 'banking:accounts:read',
          sessionId: 'session_123',
          expiresAt: new Date()
        };

        mockAuthManager.generateAuthorizationRequest.mockReturnValue(mockAuthRequest);

        const result = await provider.executeTool('get_my_accounts', {}, sessionWithoutTokens);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('User authorization required');
        expect(result.authChallenge).toBeDefined();
        expect(result.text).toContain('To complete this banking operation');
      });

      it('should refresh expired tokens', async () => {
        // Create session with expired tokens
        const expiredTokens: UserTokens = {
          ...mockSession.userTokens!,
          issuedAt: new Date(Date.now() - 7200000) // 2 hours ago
        };
        const sessionWithExpiredTokens = { ...mockSession, userTokens: expiredTokens };

        const refreshedTokens: UserTokens = {
          ...expiredTokens,
          accessToken: 'new_access_token',
          issuedAt: new Date()
        };

        mockAuthManager.isTokenExpired.mockReturnValue(true);
        mockAuthManager.refreshUserToken.mockResolvedValue(refreshedTokens);
        mockAuthManager.validateBankingScopes.mockReturnValue(true);
        mockSessionManager.associateUserTokens.mockResolvedValue();
        mockApiClient.getMyAccounts.mockResolvedValue([]);

        const result = await provider.executeTool('get_my_accounts', {}, sessionWithExpiredTokens);
        
        expect(result.success).toBe(true);
        expect(mockAuthManager.refreshUserToken).toHaveBeenCalledWith('valid_refresh_token');
        expect(mockSessionManager.associateUserTokens).toHaveBeenCalledWith('session_123', refreshedTokens);
        expect(mockApiClient.getMyAccounts).toHaveBeenCalledWith('new_access_token');
      });

      it('should request new authorization when token refresh fails', async () => {
        const expiredTokens: UserTokens = {
          ...mockSession.userTokens!,
          issuedAt: new Date(Date.now() - 7200000) // 2 hours ago
        };
        const sessionWithExpiredTokens = { ...mockSession, userTokens: expiredTokens };

        const mockAuthRequest = {
          authorizationUrl: 'https://auth.example.com/authorize',
          state: 'state_123',
          scope: 'banking:accounts:read',
          sessionId: 'session_123',
          expiresAt: new Date()
        };

        mockAuthManager.isTokenExpired.mockReturnValue(true);
        mockAuthManager.refreshUserToken.mockRejectedValue(new Error('Refresh failed'));
        mockAuthManager.generateAuthorizationRequest.mockReturnValue(mockAuthRequest);

        const result = await provider.executeTool('get_my_accounts', {}, sessionWithExpiredTokens);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('User authorization required');
        expect(result.authChallenge).toBeDefined();
      });

      it('should reject insufficient scopes', async () => {
        const limitedScopeTokens: UserTokens = {
          ...mockSession.userTokens!,
          scope: 'banking:transactions:read' // Missing banking:accounts:read
        };
        const sessionWithLimitedScopes = { ...mockSession, userTokens: limitedScopeTokens };

        const mockAuthRequest = {
          authorizationUrl: 'https://auth.example.com/authorize',
          state: 'state_123',
          scope: 'banking:accounts:read',
          sessionId: 'session_123',
          expiresAt: new Date()
        };

        mockAuthManager.isTokenExpired.mockReturnValue(false);
        mockAuthManager.validateBankingScopes.mockReturnValue(false);
        mockAuthManager.generateAuthorizationRequest.mockReturnValue(mockAuthRequest);

        const result = await provider.executeTool('get_my_accounts', {}, sessionWithLimitedScopes);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('User authorization required');
        expect(result.authChallenge).toBeDefined();
      });
    });

    describe('get_my_accounts', () => {
      it('should return formatted account list', async () => {
        mockSuccessfulAuthorization();
        
        const mockAccounts: Account[] = [
          {
            id: 'acc_123',
            userId: 'user_123',
            accountType: 'checking',
            accountNumber: '1234567890',
            balance: 1000.50,
            status: 'active',
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z'
          },
          {
            id: 'acc_456',
            userId: 'user_123',
            accountType: 'savings',
            accountNumber: '0987654321',
            balance: 5000.00,
            status: 'active',
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z'
          }
        ];

        mockApiClient.getMyAccounts.mockResolvedValue(mockAccounts);

        const result = await provider.executeTool('get_my_accounts', {}, mockSession);
        
        expect(result.success).toBe(true);
        expect(result.text).toContain('Found 2 account(s)');
        expect(result.text).toContain('Account ID: acc_123');
        expect(result.text).toContain('Type: checking');
        expect(result.text).toContain('Balance: $1000.50');
        expect(result.text).toContain('Account ID: acc_456');
        expect(result.text).toContain('Type: savings');
        expect(result.text).toContain('Balance: $5000.00');
      });

      it('should handle empty account list', async () => {
        mockSuccessfulAuthorization();
        mockApiClient.getMyAccounts.mockResolvedValue([]);

        const result = await provider.executeTool('get_my_accounts', {}, mockSession);
        
        expect(result.success).toBe(true);
        expect(result.text).toBe('No accounts found.');
      });
    });

    describe('get_account_balance', () => {
      it('should return account balance', async () => {
        mockSuccessfulAuthorization();
        mockApiClient.getAccountBalance.mockResolvedValue({ balance: 1500.75 });

        const result = await provider.executeTool('get_account_balance', { account_id: 'acc_123' }, mockSession);
        
        expect(result.success).toBe(true);
        expect(result.text).toBe('Account acc_123 balance: $1500.75');
        expect(mockApiClient.getAccountBalance).toHaveBeenCalledWith('valid_access_token', 'acc_123');
      });
    });

    describe('get_my_transactions', () => {
      it('should return formatted transaction list', async () => {
        const mockTransactions: Transaction[] = [
          {
            id: 'txn_123',
            fromAccountId: 'acc_123',
            toAccountId: 'acc_456',
            amount: 100.00,
            type: 'transfer',
            description: 'Monthly transfer',
            userId: 'user_123',
            createdAt: '2023-01-01T12:00:00Z'
          },
          {
            id: 'txn_456',
            toAccountId: 'acc_123',
            amount: 500.00,
            type: 'deposit',
            description: 'Salary deposit',
            userId: 'user_123',
            createdAt: '2023-01-01T10:00:00Z'
          }
        ];

        mockSuccessfulAuthorization();
        mockApiClient.getMyTransactions.mockResolvedValue(mockTransactions);

        const result = await provider.executeTool('get_my_transactions', {}, mockSession);
        
        expect(result.success).toBe(true);
        expect(result.text).toContain('Found 2 transaction(s)');
        expect(result.text).toContain('Transaction ID: txn_123');
        expect(result.text).toContain('Type: transfer');
        expect(result.text).toContain('Amount: $100.00');
        expect(result.text).toContain('From Account: acc_123');
        expect(result.text).toContain('To Account: acc_456');
        expect(result.text).toContain('Description: Monthly transfer');
      });

      it('should handle empty transaction list', async () => {
        mockSuccessfulAuthorization();
        mockApiClient.getMyTransactions.mockResolvedValue([]);

        const result = await provider.executeTool('get_my_transactions', {}, mockSession);
        
        expect(result.success).toBe(true);
        expect(result.text).toBe('No transactions found.');
      });
    });

    describe('create_deposit', () => {
      it('should create deposit successfully', async () => {
        const mockResponse: TransactionResponse = {
          message: 'Deposit created successfully',
          transaction: {
            id: 'txn_789',
            toAccountId: 'acc_123',
            amount: 250.00,
            type: 'deposit',
            description: 'Test deposit',
            userId: 'user_123',
            createdAt: '2023-01-01T15:00:00Z'
          }
        };

        mockSuccessfulAuthorization();
        mockApiClient.createDeposit.mockResolvedValue(mockResponse);

        const result = await provider.executeTool('create_deposit', {
          to_account_id: 'acc_123',
          amount: 250.00,
          description: 'Test deposit'
        }, mockSession);
        
        expect(result.success).toBe(true);
        expect(result.text).toContain('Deposit successful!');
        expect(result.text).toContain('Deposit created successfully');
        expect(result.text).toContain('Transaction ID: txn_789');
        expect(result.text).toContain('Amount: $250.00');
        expect(result.text).toContain('Account: acc_123');
        expect(mockApiClient.createDeposit).toHaveBeenCalledWith(
          'valid_access_token',
          'acc_123',
          250.00,
          'Test deposit'
        );
      });
    });

    describe('create_withdrawal', () => {
      it('should create withdrawal successfully', async () => {
        const mockResponse: TransactionResponse = {
          message: 'Withdrawal created successfully',
          transaction: {
            id: 'txn_890',
            fromAccountId: 'acc_123',
            amount: 150.00,
            type: 'withdrawal',
            userId: 'user_123',
            createdAt: '2023-01-01T16:00:00Z'
          }
        };

        mockSuccessfulAuthorization();
        mockApiClient.createWithdrawal.mockResolvedValue(mockResponse);

        const result = await provider.executeTool('create_withdrawal', {
          from_account_id: 'acc_123',
          amount: 150.00
        }, mockSession);
        
        expect(result.success).toBe(true);
        expect(result.text).toContain('Withdrawal successful!');
        expect(result.text).toContain('Withdrawal created successfully');
        expect(result.text).toContain('Transaction ID: txn_890');
        expect(result.text).toContain('Amount: $150.00');
        expect(result.text).toContain('Account: acc_123');
      });
    });

    describe('create_transfer', () => {
      it('should create transfer successfully', async () => {
        const mockResponse: TransactionResponse = {
          message: 'Transfer completed successfully',
          withdrawalTransaction: {
            id: 'txn_901',
            fromAccountId: 'acc_123',
            amount: 300.00,
            type: 'withdrawal',
            userId: 'user_123',
            createdAt: '2023-01-01T17:00:00Z'
          },
          depositTransaction: {
            id: 'txn_902',
            toAccountId: 'acc_456',
            amount: 300.00,
            type: 'deposit',
            userId: 'user_123',
            createdAt: '2023-01-01T17:00:00Z'
          }
        };

        mockSuccessfulAuthorization();
        mockApiClient.createTransfer.mockResolvedValue(mockResponse);

        const result = await provider.executeTool('create_transfer', {
          from_account_id: 'acc_123',
          to_account_id: 'acc_456',
          amount: 300.00,
          description: 'Transfer to savings'
        }, mockSession);
        
        expect(result.success).toBe(true);
        expect(result.text).toContain('Transfer successful!');
        expect(result.text).toContain('Transfer completed successfully');
        expect(result.text).toContain('Withdrawal Transaction ID: txn_901');
        expect(result.text).toContain('Deposit Transaction ID: txn_902');
        expect(result.text).toContain('Amount: $300.00');
        expect(result.text).toContain('From: acc_123');
        expect(result.text).toContain('To: acc_456');
      });
    });

    describe('query_user_by_email', () => {
      it('should return user information when user exists', async () => {
        const mockUserResponse = {
          user: {
            id: 'user_123',
            username: 'john.doe@example.com',
            email: 'john.doe@example.com',
            firstName: 'John',
            lastName: 'Doe',
            role: 'customer',
            isActive: true,
            createdAt: '2023-01-01T00:00:00Z',
            oauthProvider: 'p1AIC',
            oauthId: 'oauth_123'
          },
          exists: true,
          queriedBy: 'ai_agent_test',
          queriedAt: '2023-01-01T12:00:00Z'
        };

        mockSuccessfulAuthorization();
        mockApiClient.queryUserByEmail.mockResolvedValue(mockUserResponse);

        const result = await provider.executeTool('query_user_by_email', {
          email: 'john.doe@example.com'
        }, mockSession);
        
        expect(result.success).toBe(true);
        
        // Parse the JSON response
        const responseData = JSON.parse(result.text);
        expect(responseData.exists).toBe(true);
        expect(responseData.user.id).toBe('user_123');
        expect(responseData.user.email).toBe('john.doe@example.com');
        expect(responseData.user.firstName).toBe('John');
        expect(responseData.user.lastName).toBe('Doe');
        expect(responseData.user.username).toBe('john.doe@example.com');
        expect(responseData.user.role).toBe('customer');
        expect(responseData.user.isActive).toBe(true);
        expect(responseData.user.createdAt).toBe('2023-01-01T00:00:00Z');
        expect(responseData.user.oauthProvider).toBe('p1AIC');
        expect(responseData.queriedBy).toBe('ai_agent_test');
        expect(responseData.queriedAt).toBe('2023-01-01T12:00:00Z');
        expect(mockApiClient.queryUserByEmail).toHaveBeenCalledWith('valid_access_token', 'john.doe@example.com');
      });

      it('should handle user not found', async () => {
        const mockUserResponse = {
          exists: false,
          email: 'nonexistent@example.com'
        };

        mockSuccessfulAuthorization();
        mockApiClient.queryUserByEmail.mockResolvedValue(mockUserResponse);

        const result = await provider.executeTool('query_user_by_email', {
          email: 'nonexistent@example.com'
        }, mockSession);
        
        expect(result.success).toBe(true);
        
        // Parse the JSON response
        const responseData = JSON.parse(result.text);
        expect(responseData.exists).toBe(false);
        expect(responseData.email).toBe('nonexistent@example.com');
        expect(mockApiClient.queryUserByEmail).toHaveBeenCalledWith('valid_access_token', 'nonexistent@example.com');
      });

      it('should handle 404 API error as user not found', async () => {
        mockSuccessfulAuthorization();
        
        const apiError = new BankingAPIError('User not found', 404, 'USER_NOT_FOUND');
        mockApiClient.queryUserByEmail.mockRejectedValue(apiError);

        const result = await provider.executeTool('query_user_by_email', {
          email: 'notfound@example.com'
        }, mockSession);
        
        expect(result.success).toBe(true);
        
        // Parse the JSON response
        const responseData = JSON.parse(result.text);
        expect(responseData.exists).toBe(false);
        expect(responseData.email).toBe('notfound@example.com');
        expect(responseData.error).toBe('User not found');
      });

      it('should validate email parameter', async () => {
        const result = await provider.executeTool('query_user_by_email', {}, mockSession);
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid parameters');
        expect(result.text).toContain('Missing required parameter: email');
      });

      it('should use agent token when no user tokens available', async () => {
        const sessionWithoutUserTokens = { ...mockSession, userTokens: undefined };
        const mockAgentToken = 'agent_token_123';
        const mockUserResponse = {
          user: {
            id: 'user_456',
            username: 'agent.user@example.com',
            email: 'agent.user@example.com',
            firstName: 'Agent',
            lastName: 'User',
            role: 'customer',
            isActive: true,
            createdAt: '2023-01-01T00:00:00Z',
            oauthProvider: 'p1AIC',
            oauthId: 'oauth_456'
          },
          exists: true,
          queriedBy: 'ai_agent_test',
          queriedAt: '2023-01-01T12:00:00Z'
        };

        mockSuccessfulAuthorization();
        mockApiClient.queryUserByEmail.mockResolvedValue(mockUserResponse);

        const result = await provider.executeTool('query_user_by_email', {
          email: 'agent.user@example.com'
        }, sessionWithoutUserTokens, mockAgentToken);
        
        expect(result.success).toBe(true);
        
        // Parse the JSON response
        const responseData = JSON.parse(result.text);
        expect(responseData.exists).toBe(true);
        expect(responseData.user.id).toBe('user_456');
        expect(responseData.user.email).toBe('agent.user@example.com');
        expect(mockApiClient.queryUserByEmail).toHaveBeenCalledWith(mockAgentToken, 'agent.user@example.com');
      });
    });

    describe('error handling', () => {
      it('should handle BankingAPIError', async () => {
        mockSuccessfulAuthorization();
        
        const apiError = new BankingAPIError('Insufficient funds', 400, 'INSUFFICIENT_FUNDS');
        mockApiClient.getMyAccounts.mockRejectedValue(apiError);

        const result = await provider.executeTool('get_my_accounts', {}, mockSession);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('Banking API error: Insufficient funds');
        expect(result.text).toContain('Banking API error: Insufficient funds');
      });

      it('should handle AuthenticationError with auth challenge', async () => {
        mockSuccessfulAuthorization();
        
        const authError = new AuthenticationError(
          'User authorization required',
          AuthErrorCodes.USER_AUTHORIZATION_REQUIRED,
          'https://auth.example.com/authorize',
          ['banking:accounts:read']
        );
        mockApiClient.getMyAccounts.mockRejectedValue(authError);

        const result = await provider.executeTool('get_my_accounts', {}, mockSession);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('User authorization required');
        expect(result.authChallenge).toBeDefined();
        expect(result.authChallenge?.authorizationUrl).toBe('https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize');
      });

      it('should handle generic errors', async () => {
        mockSuccessfulAuthorization();
        
        const genericError = new Error('Network timeout');
        mockApiClient.getMyAccounts.mockRejectedValue(genericError);

        const result = await provider.executeTool('get_my_accounts', {}, mockSession);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('Unexpected error: Network timeout');
        expect(result.text).toContain('Unexpected error: Network timeout');
      });

      it('should handle unknown errors', async () => {
        mockSuccessfulAuthorization();
        
        mockApiClient.getMyAccounts.mockRejectedValue('string error');

        const result = await provider.executeTool('get_my_accounts', {}, mockSession);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('Unexpected error: Unknown error');
      });
    });
  });
});