/**
 * Banking Tool Provider
 * Implements banking-specific tools that call the banking API server with proper authorization
 */

import { BankingAPIClient } from '../banking/BankingAPIClient';
import { BankingAuthenticationManager } from '../auth/BankingAuthenticationManager';
import { BankingSessionManager } from '../storage/BankingSessionManager';
import { BankingToolRegistry, BankingToolDefinition } from './BankingToolRegistry';
import { BankingToolValidator } from './BankingToolValidator';
import { AuthorizationChallengeHandler, AuthorizationChallenge } from './AuthorizationChallengeHandler';
import { ToolResult, AuthorizationRequest } from '../interfaces/mcp';
import { Session, AuthErrorCodes, AuthenticationError } from '../interfaces/auth';
import { BankingAPIError } from '../interfaces/banking';

export interface ToolExecutionContext {
  session: Session;
  toolName: string;
  params: Record<string, any>;
}

export interface BankingToolResult extends ToolResult {
  type: 'text';
  text: string;
  success?: boolean;
  error?: string;
  authChallenge?: AuthorizationRequest;
}

export class BankingToolProvider {
  private authChallengeHandler: AuthorizationChallengeHandler;

  constructor(
    private apiClient: BankingAPIClient,
    private authManager: BankingAuthenticationManager,
    private sessionManager: BankingSessionManager
  ) {
    this.authChallengeHandler = new AuthorizationChallengeHandler(authManager, sessionManager);
  }

  /**
   * Execute a banking tool
   */
  async executeTool(
    toolName: string,
    params: Record<string, any>,
    session: Session,
    agentToken?: string
  ): Promise<BankingToolResult> {
    const startTime = Date.now();
    const sessionId = session.sessionId;

    console.log(`[BankingToolProvider] Starting tool execution: ${toolName} (session: ${sessionId})`);
    console.log(`[BankingToolProvider] Tool parameters:`, JSON.stringify(params, null, 2));

    try {
      // Validate tool exists
      const tool = BankingToolRegistry.getTool(toolName);
      if (!tool) {
        console.error(`[BankingToolProvider] Unknown tool requested: ${toolName}`);
        return this.createErrorResult(`Unknown tool: ${toolName}`);
      }

      console.log(`[BankingToolProvider] Tool found: ${tool.name}, required scopes: [${tool.requiredScopes.join(', ')}]`);

      // Validate parameters
      const paramValidation = BankingToolValidator.validateToolParams(toolName, params);
      if (!paramValidation.isValid) {
        console.error(`[BankingToolProvider] Parameter validation failed for ${toolName}:`, paramValidation.errors);
        return this.createErrorResult(`Invalid parameters: ${paramValidation.errors.join(', ')}`);
      }

      console.log(`[BankingToolProvider] Parameters validated successfully for ${toolName}`);

      // Check user authorization using the challenge handler (only for tools that require user auth)
      if (tool.requiresUserAuth && tool.requiredScopes.length > 0) {
        console.log(`[BankingToolProvider] Checking authorization for scopes: [${tool.requiredScopes.join(', ')}]`);
        const challengeResult = await this.authChallengeHandler.detectAuthorizationChallenge(
          session,
          tool.requiredScopes
        );

        if (challengeResult.challengeNeeded) {
          console.log(`[BankingToolProvider] Authorization challenge required for ${toolName}`);
          return this.createAuthChallengeResult(challengeResult.challenge!);
        }

        console.log(`[BankingToolProvider] Authorization check passed for ${toolName}`);
      } else {
        console.log(`[BankingToolProvider] Tool ${toolName} does not require user authorization, skipping auth check`);
      }

      // Execute the specific tool
      const sanitizedParams = paramValidation.sanitizedParams!;
      const context: ToolExecutionContext = {
        session,
        toolName,
        params: sanitizedParams
      };

      console.log(`[BankingToolProvider] Executing tool handler: ${tool.handler}`);
      const result = await this.executeSpecificTool(tool, context, agentToken);

      const executionTime = Date.now() - startTime;
      console.log(`[BankingToolProvider] Tool execution completed: ${toolName} (${executionTime}ms) - Success: ${result.success}`);

      return result;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error(`[BankingToolProvider] Error executing tool ${toolName} (${executionTime}ms):`, error);

      if (error instanceof AuthenticationError) {
        console.error(`[BankingToolProvider] Authentication error for ${toolName}: ${error.message}`);
        if (error.code === AuthErrorCodes.USER_AUTHORIZATION_REQUIRED && error.authorizationUrl) {
          // Generate a proper authorization challenge
          const challenge = await this.authChallengeHandler.generateAuthorizationChallenge(
            session.sessionId,
            error.requiredScopes || []
          );
          return this.createAuthChallengeResult(challenge);
        }
        return this.createErrorResult(`Authentication error: ${error.message}`);
      }

      if (error instanceof BankingAPIError) {
        console.error(`[BankingToolProvider] Banking API error for ${toolName}: ${error.message}`);
        return this.createErrorResult(`Banking API error: ${error.message}`);
      }

      console.error(`[BankingToolProvider] Unexpected error for ${toolName}:`, error);
      return this.createErrorResult(`Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get available tools for MCP protocol
   */
  getAvailableTools(): BankingToolDefinition[] {
    return BankingToolRegistry.getAllTools();
  }

  /**
   * Handle authorization code from user
   */
  async handleAuthorizationCode(
    sessionId: string,
    authorizationCode: string,
    state: string
  ): Promise<BankingToolResult> {
    try {
      const result = await this.authChallengeHandler.handleAuthorizationCode({
        sessionId,
        authorizationCode,
        state
      });

      if (result.success) {
        // Get the most recent token's expiration time
        let expiresIn = 0;
        if (result.userTokens) {
          expiresIn = result.userTokens.expiresIn;
        }

        return this.createSuccessResult(
          `Authorization successful! You can now use banking tools.\n` +
          `Token expires in ${Math.floor(expiresIn / 60)} minutes.`
        );
      } else {
        return this.createErrorResult(`Authorization failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Error handling authorization code:', error);
      return this.createErrorResult(
        `Authorization processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Check if a session needs re-authorization for specific scopes
   */
  async checkReauthorizationNeeded(
    session: Session,
    requiredScopes: string[]
  ): Promise<boolean> {
    return await this.authChallengeHandler.checkReauthorizationNeeded(session, requiredScopes);
  }

  /**
   * Execute specific tool based on handler
   */
  private async executeSpecificTool(
    tool: BankingToolDefinition,
    context: ToolExecutionContext,
    agentToken?: string
  ): Promise<BankingToolResult> {
    // For tools that don't require user auth, use agent token if available
    let token: string;
    if (!tool.requiresUserAuth && agentToken) {
      token = agentToken;
      console.log(`[BankingToolProvider] Using agent token for ${tool.name}`);
    } else {
      const userToken = this.getUserTokenForScopes(context.session, tool.requiredScopes);
      if (!userToken) {
        throw new AuthenticationError(
          'No valid user tokens found for required scopes',
          AuthErrorCodes.USER_AUTHORIZATION_REQUIRED,
          undefined,
          tool.requiredScopes
        );
      }
      token = userToken.accessToken;
      console.log(`[BankingToolProvider] Using user token for ${tool.name}`);
    }

    switch (tool.handler) {
      case 'executeGetMyAccounts':
        return await this.executeGetMyAccounts(token);

      case 'executeGetAccountBalance':
        return await this.executeGetAccountBalance(token, context.params as { account_id: string });

      case 'executeGetMyTransactions':
        return await this.executeGetMyTransactions(token);

      case 'executeCreateDeposit':
        return await this.executeCreateDeposit(token, context.params as { to_account_id: string; amount: number; description?: string });

      case 'executeCreateWithdrawal':
        return await this.executeCreateWithdrawal(token, context.params as { from_account_id: string; amount: number; description?: string });

      case 'executeCreateTransfer':
        return await this.executeCreateTransfer(token, context.params as { from_account_id: string; to_account_id: string; amount: number; description?: string });

      case 'executeQueryUserByEmail':
        return await this.executeQueryUserByEmail(token, context.params as { email: string });

      default:
        return this.createErrorResult(`Unknown tool handler: ${tool.handler}`);
    }
  }

  /**
   * Execute get_my_accounts tool
   */
  private async executeGetMyAccounts(userToken: string): Promise<BankingToolResult> {
    try {
      console.log(`[BankingToolProvider] Calling Banking API: getMyAccounts`);
      const accounts = await this.apiClient.getMyAccounts(userToken);
      console.log(`[BankingToolProvider] Banking API raw response:`, accounts);
      console.log(`[BankingToolProvider] Response type:`, typeof accounts);
      console.log(`[BankingToolProvider] Is array:`, Array.isArray(accounts));

      if (accounts && accounts.length !== undefined) {
        console.log(`[BankingToolProvider] Banking API response: Found ${accounts.length} accounts`);
      } else {
        console.log(`[BankingToolProvider] Banking API response: accounts is not an array or is undefined`);
      }

      // Return structured JSON response
      const response = {
        success: true,
        count: accounts.length,
        accounts: accounts.map(account => ({
          id: account.id,
          type: account.accountType,
          number: account.accountNumber,
          balance: account.balance,
          status: account.status || 'active'
        }))
      };

      return this.createSuccessResult(JSON.stringify(response, null, 2));
    } catch (error) {
      throw error; // Re-throw to be handled by main executeTool method
    }
  }

  /**
   * Execute get_account_balance tool
   */
  private async executeGetAccountBalance(
    userToken: string,
    params: { account_id: string }
  ): Promise<BankingToolResult> {
    try {
      console.log(`[BankingToolProvider] Calling Banking API: getAccountBalance for account ${params.account_id}`);
      const balanceResponse = await this.apiClient.getAccountBalance(userToken, params.account_id);
      console.log(`[BankingToolProvider] Banking API response: Account balance ${balanceResponse.balance}`);

      // Return structured JSON response
      const response = {
        success: true,
        accountId: params.account_id,
        balance: balanceResponse.balance
      };

      return this.createSuccessResult(JSON.stringify(response, null, 2));
    } catch (error) {
      throw error; // Re-throw to be handled by main executeTool method
    }
  }

  /**
   * Execute get_my_transactions tool
   */
  private async executeGetMyTransactions(userToken: string): Promise<BankingToolResult> {
    try {
      const transactions = await this.apiClient.getMyTransactions(userToken);

      // Validate that transactions is an array
      if (!Array.isArray(transactions)) {
        console.error(`[BankingToolProvider] Expected transactions to be an array, got:`, typeof transactions, transactions);
        
        // Return structured error response
        const errorResponse = {
          success: false,
          error: 'Invalid response format from banking API',
          receivedType: typeof transactions,
          receivedData: transactions
        };
        
        return this.createSuccessResult(JSON.stringify(errorResponse, null, 2));
      }

      // Return structured JSON response
      const response = {
        success: true,
        count: transactions.length,
        transactions: transactions.map(transaction => ({
          id: transaction.id,
          type: transaction.type,
          amount: transaction.amount,
          date: transaction.createdAt,
          fromAccountId: transaction.fromAccountId || null,
          toAccountId: transaction.toAccountId || null,
          description: transaction.description || null
        }))
      };

      return this.createSuccessResult(JSON.stringify(response, null, 2));
    } catch (error) {
      throw error; // Re-throw to be handled by main executeTool method
    }
  }

  /**
   * Execute create_deposit tool
   */
  private async executeCreateDeposit(
    userToken: string,
    params: { to_account_id: string; amount: number; description?: string }
  ): Promise<BankingToolResult> {
    try {
      console.log(`[BankingToolProvider] Calling Banking API: createDeposit - Amount: ${params.amount}, Account: ${params.to_account_id}`);
      const response = await this.apiClient.createDeposit(
        userToken,
        params.to_account_id,
        params.amount,
        params.description
      );
      console.log(`[BankingToolProvider] Banking API response: Deposit successful - ${response.message}`);

      // Return structured JSON response
      const result = {
        success: true,
        operation: 'deposit',
        message: response.message,
        transaction: response.transaction ? {
          id: response.transaction.id,
          amount: params.amount,
          toAccountId: params.to_account_id,
          description: params.description || null
        } : null,
        amount: params.amount,
        accountId: params.to_account_id
      };

      return this.createSuccessResult(JSON.stringify(result, null, 2));
    } catch (error) {
      throw error; // Re-throw to be handled by main executeTool method
    }
  }

  /**
   * Execute create_withdrawal tool
   */
  private async executeCreateWithdrawal(
    userToken: string,
    params: { from_account_id: string; amount: number; description?: string }
  ): Promise<BankingToolResult> {
    try {
      const response = await this.apiClient.createWithdrawal(
        userToken,
        params.from_account_id,
        params.amount,
        params.description
      );

      // Return structured JSON response
      const result = {
        success: true,
        operation: 'withdrawal',
        message: response.message,
        transaction: response.transaction ? {
          id: response.transaction.id,
          amount: params.amount,
          fromAccountId: params.from_account_id,
          description: params.description || null
        } : null,
        amount: params.amount,
        accountId: params.from_account_id
      };

      return this.createSuccessResult(JSON.stringify(result, null, 2));
    } catch (error) {
      throw error; // Re-throw to be handled by main executeTool method
    }
  }

  /**
   * Execute create_transfer tool
   */
  private async executeCreateTransfer(
    userToken: string,
    params: { from_account_id: string; to_account_id: string; amount: number; description?: string }
  ): Promise<BankingToolResult> {
    try {
      const response = await this.apiClient.createTransfer(
        userToken,
        params.from_account_id,
        params.to_account_id,
        params.amount,
        params.description
      );

      // Return structured JSON response
      const result = {
        success: true,
        operation: 'transfer',
        message: response.message,
        withdrawalTransaction: response.withdrawalTransaction ? {
          id: response.withdrawalTransaction.id,
          amount: params.amount,
          fromAccountId: params.from_account_id
        } : null,
        depositTransaction: response.depositTransaction ? {
          id: response.depositTransaction.id,
          amount: params.amount,
          toAccountId: params.to_account_id
        } : null,
        amount: params.amount,
        fromAccountId: params.from_account_id,
        toAccountId: params.to_account_id,
        description: params.description || null
      };

      return this.createSuccessResult(JSON.stringify(result, null, 2));
    } catch (error) {
      throw error; // Re-throw to be handled by main executeTool method
    }
  }

  /**
   * Execute query_user_by_email tool
   */
  private async executeQueryUserByEmail(
    userToken: string,
    params: { email: string }
  ): Promise<BankingToolResult> {
    try {
      console.log(`[BankingToolProvider] Calling Banking API: queryUserByEmail for ${params.email}`);
      const response = await this.apiClient.queryUserByEmail(userToken, params.email);
      console.log(`[BankingToolProvider] Banking API response:`, response);

      // Return the complete API response as JSON
      return this.createSuccessResult(JSON.stringify(response, null, 2));
    } catch (error) {
      // Handle 404 as a normal "not found" response rather than an error
      if (error instanceof BankingAPIError && error.statusCode === 404) {
        const notFoundResponse = {
          exists: false,
          email: params.email,
          error: "User not found"
        };
        return this.createSuccessResult(JSON.stringify(notFoundResponse, null, 2));
      }
      throw error; // Re-throw other errors to be handled by main executeTool method
    }
  }

  /**
   * Create a successful tool result
   */
  private createSuccessResult(text: string): BankingToolResult {
    return {
      type: 'text',
      text,
      success: true
    };
  }

  /**
   * Create an error tool result
   */
  private createErrorResult(error: string): BankingToolResult {
    return {
      type: 'text',
      text: `Error: ${error}`,
      success: false,
      error
    };
  }

  /**
   * Create an authorization challenge result
   */
  private createAuthChallengeResult(challenge: AuthorizationChallenge): BankingToolResult {
    const mcpChallenge = this.authChallengeHandler.formatMCPAuthorizationChallenge(challenge);

    return {
      type: 'text',
      text: mcpChallenge.text,
      success: false,
      error: 'User authorization required',
      authChallenge: mcpChallenge.authChallenge
    };
  }

  /**
   * Get user token that has the required scopes
   */
  private getUserTokenForScopes(session: Session, requiredScopes: string[]): import('../interfaces/auth').UserTokens | null {
    if (!session.userTokens) {
      return null;
    }

    // Handle both single token and token array
    const tokens = Array.isArray(session.userTokens) ? session.userTokens : [session.userTokens];

    // Find tokens that have all required scopes and are not expired
    for (const userToken of tokens) {
      if (this.authManager.isTokenExpired(userToken)) {
        continue;
      }

      const tokenScopes = userToken.scope.split(' ');
      const hasAllScopes = requiredScopes.every(scope => tokenScopes.includes(scope));

      if (hasAllScopes) {
        return userToken;
      }
    }

    return null;
  }
}