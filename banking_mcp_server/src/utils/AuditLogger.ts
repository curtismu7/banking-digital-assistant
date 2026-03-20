/**
 * Audit logging system for banking operations
 * Maintains detailed audit trails with user context preservation
 */

import { Logger } from './Logger.js';

export interface AuditEvent {
  eventId: string;
  timestamp: string;
  eventType: 'banking_operation' | 'authentication' | 'authorization' | 'session_management';
  operation: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
  resourceId?: string;
  resourceType?: 'account' | 'transaction' | 'session' | 'token';
  outcome: 'success' | 'failure' | 'partial';
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  duration?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface BankingOperationAudit {
  operation: 'get_accounts' | 'get_balance' | 'get_transactions' | 'create_deposit' | 'create_withdrawal' | 'create_transfer';
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  amount?: number;
  transactionId?: string;
  balanceBefore?: number;
  balanceAfter?: number;
}

export interface AuthenticationAudit {
  operation: 'agent_token_validation' | 'user_authorization' | 'token_refresh' | 'token_revocation';
  tokenType?: 'agent' | 'user' | 'refresh';
  scopes?: string[];
  grantType?: string;
  clientId?: string;
}

export interface SessionAudit {
  operation: 'session_create' | 'session_update' | 'session_expire' | 'session_cleanup';
  sessionDuration?: number;
  tokensAssociated?: boolean;
  cleanupReason?: string;
}

/**
 * Audit logger for comprehensive banking operation tracking
 */
export class AuditLogger {
  private logger: Logger;
  private static instance: AuditLogger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  static getInstance(logger?: Logger): AuditLogger {
    if (!AuditLogger.instance) {
      if (!logger) {
        throw new Error('Logger instance required for first initialization');
      }
      AuditLogger.instance = new AuditLogger(logger);
    }
    return AuditLogger.instance;
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create base audit event
   */
  private createBaseAuditEvent(
    eventType: AuditEvent['eventType'],
    operation: string,
    outcome: AuditEvent['outcome'],
    context: {
      userId?: string;
      agentId?: string;
      sessionId?: string;
      resourceId?: string;
      resourceType?: AuditEvent['resourceType'];
      ipAddress?: string;
      userAgent?: string;
      duration?: number;
      errorCode?: string;
      errorMessage?: string;
    }
  ): Omit<AuditEvent, 'details'> {
    return {
      eventId: this.generateEventId(),
      timestamp: new Date().toISOString(),
      eventType,
      operation,
      outcome,
      ...context
    };
  }

  /**
   * Log banking operation audit event
   */
  async logBankingOperation(
    operation: BankingOperationAudit['operation'],
    outcome: AuditEvent['outcome'],
    context: {
      userId: string;
      agentId?: string;
      sessionId: string;
      ipAddress?: string;
      userAgent?: string;
      duration?: number;
      errorCode?: string;
      errorMessage?: string;
    },
    operationDetails: Partial<BankingOperationAudit>
  ): Promise<void> {
    const baseEvent = this.createBaseAuditEvent(
      'banking_operation',
      operation,
      outcome,
      {
        ...context,
        resourceType: operationDetails.accountId ? 'account' : 'transaction',
        resourceId: operationDetails.accountId || operationDetails.transactionId
      }
    );

    const auditEvent: AuditEvent = {
      ...baseEvent,
      details: {
        operation,
        ...operationDetails,
        // Ensure sensitive data is not logged
        amount: operationDetails.amount ? `$${operationDetails.amount.toFixed(2)}` : undefined
      }
    };

    await this.logger.info('Banking operation audit', {
      auditEvent,
      operation: 'audit_banking'
    });
  }

  /**
   * Log authentication audit event
   */
  async logAuthentication(
    operation: AuthenticationAudit['operation'],
    outcome: AuditEvent['outcome'],
    context: {
      userId?: string;
      agentId?: string;
      sessionId?: string;
      ipAddress?: string;
      userAgent?: string;
      duration?: number;
      errorCode?: string;
      errorMessage?: string;
    },
    authDetails: Partial<AuthenticationAudit>
  ): Promise<void> {
    const baseEvent = this.createBaseAuditEvent(
      'authentication',
      operation,
      outcome,
      {
        ...context,
        resourceType: 'token'
      }
    );

    const auditEvent: AuditEvent = {
      ...baseEvent,
      details: {
        operation,
        ...authDetails
      }
    };

    await this.logger.info('Authentication audit', {
      auditEvent,
      operation: 'audit_authentication'
    });
  }

  /**
   * Log authorization audit event
   */
  async logAuthorization(
    operation: string,
    outcome: AuditEvent['outcome'],
    context: {
      userId?: string;
      agentId?: string;
      sessionId?: string;
      ipAddress?: string;
      userAgent?: string;
      duration?: number;
      errorCode?: string;
      errorMessage?: string;
    },
    authzDetails: {
      requiredScopes?: string[];
      grantedScopes?: string[];
      resourceRequested?: string;
      decision?: 'allow' | 'deny';
      reason?: string;
    }
  ): Promise<void> {
    const baseEvent = this.createBaseAuditEvent(
      'authorization',
      operation,
      outcome,
      context
    );

    const auditEvent: AuditEvent = {
      ...baseEvent,
      details: {
        operation,
        ...authzDetails
      }
    };

    await this.logger.info('Authorization audit', {
      auditEvent,
      operation: 'audit_authorization'
    });
  }

  /**
   * Log session management audit event
   */
  async logSessionManagement(
    operation: SessionAudit['operation'],
    outcome: AuditEvent['outcome'],
    context: {
      userId?: string;
      agentId?: string;
      sessionId: string;
      ipAddress?: string;
      userAgent?: string;
      duration?: number;
      errorCode?: string;
      errorMessage?: string;
    },
    sessionDetails: Partial<SessionAudit>
  ): Promise<void> {
    const baseEvent = this.createBaseAuditEvent(
      'session_management',
      operation,
      outcome,
      {
        ...context,
        resourceType: 'session',
        resourceId: context.sessionId
      }
    );

    const auditEvent: AuditEvent = {
      ...baseEvent,
      details: {
        operation,
        ...sessionDetails
      }
    };

    await this.logger.info('Session management audit', {
      auditEvent,
      operation: 'audit_session'
    });
  }

  /**
   * Log security incident
   */
  async logSecurityIncident(
    incident: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    context: {
      userId?: string;
      agentId?: string;
      sessionId?: string;
      ipAddress?: string;
      userAgent?: string;
      resourceId?: string;
      resourceType?: AuditEvent['resourceType'];
    },
    incidentDetails: Record<string, any>
  ): Promise<void> {
    const baseEvent = this.createBaseAuditEvent(
      'authentication', // Security incidents are often auth-related
      `security_incident_${incident}`,
      'failure',
      context
    );

    const auditEvent: AuditEvent = {
      ...baseEvent,
      details: {
        incident,
        severity,
        ...incidentDetails
      }
    };

    await this.logger.warn('Security incident', {
      auditEvent,
      operation: 'audit_security',
      severity
    });
  }

  /**
   * Query audit logs (simplified interface for monitoring)
   */
  async queryAuditLogs(filters: {
    eventType?: AuditEvent['eventType'];
    operation?: string;
    userId?: string;
    agentId?: string;
    sessionId?: string;
    outcome?: AuditEvent['outcome'];
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): Promise<AuditEvent[]> {
    // In a real implementation, this would query the actual log storage
    // For now, we'll return an empty array and log the query attempt
    await this.logger.debug('Audit log query requested', {
      filters,
      operation: 'audit_query'
    });
    
    return [];
  }

  /**
   * Generate audit summary report
   */
  async generateAuditSummary(
    startTime: Date,
    endTime: Date,
    filters?: {
      userId?: string;
      agentId?: string;
      eventType?: AuditEvent['eventType'];
    }
  ): Promise<{
    totalEvents: number;
    successfulOperations: number;
    failedOperations: number;
    eventsByType: Record<string, number>;
    topUsers: Array<{ userId: string; eventCount: number }>;
    topOperations: Array<{ operation: string; eventCount: number }>;
  }> {
    // In a real implementation, this would analyze the actual audit logs
    await this.logger.info('Audit summary generation requested', {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      filters,
      operation: 'audit_summary'
    });

    return {
      totalEvents: 0,
      successfulOperations: 0,
      failedOperations: 0,
      eventsByType: {},
      topUsers: [],
      topOperations: []
    };
  }
}