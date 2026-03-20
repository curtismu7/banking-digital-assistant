/**
 * Banking API Client
 * HTTP client for communicating with the banking API server
 */

import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import {
  Account,
  Transaction,
  TransactionRequest,
  TransactionResponse,
  AccountBalanceResponse,
  BankingAPIConfig,
  BankingAPIError,
  UserQueryResponse
} from '../interfaces/banking';
import { CircuitBreaker, CircuitBreakerConfig, CircuitBreakerError } from '../utils/CircuitBreaker';
import { RetryManager, RetryConfig, RetryError } from '../utils/RetryManager';

export interface BankingAPIClientOptions extends Partial<BankingAPIConfig> {
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
  retryConfig?: Partial<RetryConfig>;
}

export class BankingAPIClient {
  private client: AxiosInstance;
  private config: BankingAPIConfig;
  private circuitBreaker: CircuitBreaker;
  private retryManager: RetryManager;

  constructor(options: BankingAPIClientOptions = {}) {
    this.config = {
      baseUrl: options.baseUrl || 'http://localhost:3001',
      timeout: options.timeout || 30000,
      maxRetries: options.maxRetries || 3,
      circuitBreakerThreshold: options.circuitBreakerThreshold || 5
    };

    // Initialize circuit breaker
    const circuitBreakerConfig: CircuitBreakerConfig = {
      failureThreshold: this.config.circuitBreakerThreshold,
      resetTimeout: 60000, // 1 minute
      monitoringPeriod: 10000, // 10 seconds
      ...options.circuitBreakerConfig
    };
    this.circuitBreaker = new CircuitBreaker(circuitBreakerConfig);

    // Initialize retry manager
    const retryConfig: RetryConfig = {
      maxRetries: this.config.maxRetries,
      baseDelay: 1000, // 1 second
      maxDelay: 30000, // 30 seconds
      backoffMultiplier: 2,
      jitter: true,
      ...options.retryConfig
    };
    this.retryManager = new RetryManager(retryConfig);

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        console.log(`Banking API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('Banking API Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => {
        console.log(`Banking API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        const bankingError = this.mapError(error);
        console.error('Banking API Error:', bankingError);
        return Promise.reject(bankingError);
      }
    );
  }

  /**
   * Get user's accounts
   */
  async getMyAccounts(userToken: string): Promise<Account[]> {
    const response = await this.makeAuthenticatedRequest<{accounts: Account[]}>(
      'GET',
      '/api/accounts/my',
      userToken
    );
    
    console.log(`[BankingAPIClient] getMyAccounts raw response:`, {
      status: response.status,
      data: response.data,
      dataType: typeof response.data,
      isArray: Array.isArray(response.data),
      accountsArray: Array.isArray(response.data.accounts),
      accountsLength: response.data.accounts?.length
    });
    
    // Extract the accounts array from the response object
    return response.data.accounts || [];
  }

  /**
   * Get account balance for a specific account
   */
  async getAccountBalance(userToken: string, accountId: string): Promise<AccountBalanceResponse> {
    const response = await this.makeAuthenticatedRequest<AccountBalanceResponse>(
      'GET',
      `/api/accounts/${accountId}/balance`,
      userToken
    );
    return response.data;
  }

  /**
   * Get user's transactions
   */
  async getMyTransactions(userToken: string): Promise<Transaction[]> {
    const response = await this.makeAuthenticatedRequest<{transactions: Transaction[]}>(
      'GET',
      '/api/transactions/my',
      userToken
    );
    
    console.log(`[BankingAPIClient] getMyTransactions raw response:`, {
      status: response.status,
      data: response.data,
      dataType: typeof response.data,
      isArray: Array.isArray(response.data),
      transactionsArray: Array.isArray(response.data.transactions),
      transactionsLength: response.data.transactions?.length
    });
    
    // Extract the transactions array from the response object
    return response.data.transactions || [];
  }

  /**
   * Create a transaction (deposit, withdrawal, or transfer)
   */
  async createTransaction(userToken: string, transactionData: TransactionRequest): Promise<TransactionResponse> {
    const response = await this.makeAuthenticatedRequest<TransactionResponse>(
      'POST',
      '/api/transactions',
      userToken,
      transactionData
    );
    return response.data;
  }

  /**
   * Create a deposit transaction
   */
  async createDeposit(
    userToken: string, 
    toAccountId: string, 
    amount: number, 
    description?: string
  ): Promise<TransactionResponse> {
    this.validateTransactionAmount(amount);
    this.validateAccountId(toAccountId);

    const transactionData: TransactionRequest = {
      toAccountId,
      amount,
      type: 'deposit',
      description
    };
    return this.createTransaction(userToken, transactionData);
  }

  /**
   * Create a withdrawal transaction
   */
  async createWithdrawal(
    userToken: string, 
    fromAccountId: string, 
    amount: number, 
    description?: string
  ): Promise<TransactionResponse> {
    this.validateTransactionAmount(amount);
    this.validateAccountId(fromAccountId);

    const transactionData: TransactionRequest = {
      fromAccountId,
      amount,
      type: 'withdrawal',
      description
    };
    return this.createTransaction(userToken, transactionData);
  }

  /**
   * Create a transfer transaction
   */
  async createTransfer(
    userToken: string, 
    fromAccountId: string, 
    toAccountId: string, 
    amount: number, 
    description?: string
  ): Promise<TransactionResponse> {
    this.validateTransactionAmount(amount);
    this.validateAccountId(fromAccountId);
    this.validateAccountId(toAccountId);

    if (fromAccountId === toAccountId) {
      throw new BankingAPIError(
        'Cannot transfer to the same account',
        400,
        'SAME_ACCOUNT_TRANSFER'
      );
    }

    const transactionData: TransactionRequest = {
      fromAccountId,
      toAccountId,
      amount,
      type: 'transfer',
      description
    };
    return this.createTransaction(userToken, transactionData);
  }

  /**
   * Query user by email address
   */
  async queryUserByEmail(userToken: string, email: string): Promise<UserQueryResponse> {
    this.validateEmail(email);

    const response = await this.makeAuthenticatedRequest<UserQueryResponse>(
      'GET',
      `/api/users/query/by-email/${encodeURIComponent(email)}`,
      userToken
    );
    return response.data;
  }

  /**
   * Validate transaction amount
   */
  private validateTransactionAmount(amount: number): void {
    if (typeof amount !== 'number' || isNaN(amount)) {
      throw new BankingAPIError(
        'Amount must be a valid number',
        400,
        'INVALID_AMOUNT'
      );
    }

    if (amount <= 0) {
      throw new BankingAPIError(
        'Amount must be greater than zero',
        400,
        'INVALID_AMOUNT'
      );
    }

    if (!Number.isFinite(amount)) {
      throw new BankingAPIError(
        'Amount must be a finite number',
        400,
        'INVALID_AMOUNT'
      );
    }

    // Check for reasonable precision (2 decimal places for currency)
    const decimalPlaces = (amount.toString().split('.')[1] || '').length;
    if (decimalPlaces > 2) {
      throw new BankingAPIError(
        'Amount cannot have more than 2 decimal places',
        400,
        'INVALID_AMOUNT_PRECISION'
      );
    }
  }

  /**
   * Validate account ID
   */
  private validateAccountId(accountId: string): void {
    if (!accountId || typeof accountId !== 'string') {
      throw new BankingAPIError(
        'Account ID must be a non-empty string',
        400,
        'INVALID_ACCOUNT_ID'
      );
    }

    if (accountId.trim().length === 0) {
      throw new BankingAPIError(
        'Account ID cannot be empty or whitespace',
        400,
        'INVALID_ACCOUNT_ID'
      );
    }
  }

  /**
   * Validate email address
   */
  private validateEmail(email: string): void {
    if (!email || typeof email !== 'string') {
      throw new BankingAPIError(
        'Email must be a non-empty string',
        400,
        'INVALID_EMAIL'
      );
    }

    if (email.trim().length === 0) {
      throw new BankingAPIError(
        'Email cannot be empty or whitespace',
        400,
        'INVALID_EMAIL'
      );
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      throw new BankingAPIError(
        'Invalid email format',
        400,
        'INVALID_EMAIL_FORMAT'
      );
    }
  }

  /**
   * Make an authenticated request to the banking API with circuit breaker and retry logic
   */
  private async makeAuthenticatedRequest<T>(
    method: string,
    endpoint: string,
    userToken: string,
    data?: any
  ): Promise<AxiosResponse<T>> {
    const config = {
      method: method.toLowerCase(),
      url: endpoint,
      headers: {
        'Authorization': `Bearer ${userToken}`
      },
      ...(data && { data })
    };

    try {
      return await this.circuitBreaker.execute(async () => {
        return await this.retryManager.execute(
          async () => {
            return await this.client.request<T>(config);
          },
          (error: Error) => this.shouldRetryRequest(error)
        );
      });
    } catch (error) {
      if (error instanceof CircuitBreakerError) {
        throw new BankingAPIError(
          'Banking API is currently unavailable (circuit breaker open)',
          503,
          'SERVICE_UNAVAILABLE',
          error
        );
      }
      
      if (error instanceof RetryError) {
        throw this.mapError(error.originalError);
      }

      throw this.mapError(error);
    }
  }

  /**
   * Determine if a request should be retried
   */
  private shouldRetryRequest(error: Error): boolean {
    // Don't retry authentication errors (4xx except 429)
    if ('statusCode' in error) {
      const statusCode = (error as any).statusCode;
      if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
        return false;
      }
    }

    // Don't retry client validation errors
    if (error instanceof BankingAPIError) {
      const nonRetryableCodes = [
        'INVALID_AMOUNT',
        'INVALID_ACCOUNT_ID',
        'SAME_ACCOUNT_TRANSFER',
        'INVALID_AMOUNT_PRECISION'
      ];
      if (nonRetryableCodes.includes(error.errorCode || '')) {
        return false;
      }
    }

    // Use default retry logic for other errors
    return true;
  }

  /**
   * Map axios errors to BankingAPIError
   */
  private mapError(error: any): BankingAPIError {
    if (error instanceof BankingAPIError) {
      return error;
    }

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.response) {
        // Server responded with error status
        const { status, data } = axiosError.response;
        const errorData = data as any;
        
        return new BankingAPIError(
          errorData?.error || errorData?.message || 'Banking API error',
          status,
          errorData?.code || errorData?.errorCode,
          axiosError
        );
      } else if (axiosError.request) {
        // Request was made but no response received
        return new BankingAPIError(
          'No response from banking API server',
          0,
          'NO_RESPONSE',
          axiosError
        );
      } else {
        // Error in request setup
        return new BankingAPIError(
          'Request setup error',
          0,
          'REQUEST_SETUP_ERROR',
          axiosError
        );
      }
    }

    // Unknown error type
    return new BankingAPIError(
      error.message || 'Unknown banking API error',
      500,
      'UNKNOWN_ERROR',
      error
    );
  }

  /**
   * Get client configuration
   */
  getConfig(): BankingAPIConfig {
    return { ...this.config };
  }

  /**
   * Update client configuration
   */
  updateConfig(newConfig: Partial<BankingAPIConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Update axios instance with new config
    this.client.defaults.baseURL = this.config.baseUrl;
    this.client.defaults.timeout = this.config.timeout;
  }

  /**
   * Get circuit breaker statistics
   */
  getCircuitBreakerStats() {
    return this.circuitBreaker.getStats();
  }

  /**
   * Get retry manager configuration
   */
  getRetryConfig() {
    return this.retryManager.getConfig();
  }

  /**
   * Manually reset the circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.manualReset();
  }
}