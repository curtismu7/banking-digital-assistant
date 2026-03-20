/**
 * Structured logging utility for OAuth token validation and error handling
 * Provides consistent logging format across the application
 */

const fs = require('fs');
const path = require('path');

// Log levels
const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG'
};

// Log categories for better organization
const LOG_CATEGORIES = {
  OAUTH_VALIDATION: 'oauth_validation',
  SCOPE_VALIDATION: 'scope_validation',
  TOKEN_INTROSPECTION: 'token_introspection',
  PROVIDER_HEALTH: 'provider_health',
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  ERROR_HANDLING: 'error_handling'
};

class StructuredLogger {
  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'INFO';
    this.enableFileLogging = process.env.ENABLE_FILE_LOGGING === 'true';
    this.logDirectory = process.env.LOG_DIRECTORY || './logs';
    
    // Create logs directory if file logging is enabled
    if (this.enableFileLogging) {
      this.ensureLogDirectory();
    }
  }

  ensureLogDirectory() {
    try {
      if (!fs.existsSync(this.logDirectory)) {
        fs.mkdirSync(this.logDirectory, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create log directory:', error.message);
    }
  }

  shouldLog(level) {
    const levels = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex <= currentLevelIndex;
  }

  formatLogEntry(level, category, message, metadata = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      category,
      message,
      ...metadata
    };

    return {
      formatted: JSON.stringify(logEntry),
      entry: logEntry
    };
  }

  writeToFile(logEntry, level) {
    if (!this.enableFileLogging) return;

    try {
      const filename = `${level.toLowerCase()}.log`;
      const filepath = path.join(this.logDirectory, filename);
      fs.appendFileSync(filepath, logEntry + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  log(level, category, message, metadata = {}) {
    if (!this.shouldLog(level)) return;

    const { formatted, entry } = this.formatLogEntry(level, category, message, metadata);
    
    // Console output with color coding
    const colorCode = {
      ERROR: '\x1b[31m', // Red
      WARN: '\x1b[33m',  // Yellow
      INFO: '\x1b[36m',  // Cyan
      DEBUG: '\x1b[90m'  // Gray
    };
    
    const resetColor = '\x1b[0m';
    console.log(`${colorCode[level]}[${level}]${resetColor} ${formatted}`);
    
    // Write to file if enabled
    this.writeToFile(formatted, level);
    
    return entry;
  }

  error(category, message, metadata = {}) {
    return this.log(LOG_LEVELS.ERROR, category, message, metadata);
  }

  warn(category, message, metadata = {}) {
    return this.log(LOG_LEVELS.WARN, category, message, metadata);
  }

  info(category, message, metadata = {}) {
    return this.log(LOG_LEVELS.INFO, category, message, metadata);
  }

  debug(category, message, metadata = {}) {
    return this.log(LOG_LEVELS.DEBUG, category, message, metadata);
  }

  // OAuth-specific logging methods
  logOAuthValidation(success, metadata = {}) {
    const level = success ? LOG_LEVELS.INFO : LOG_LEVELS.ERROR;
    const message = success ? 'OAuth token validation successful' : 'OAuth token validation failed';
    return this.log(level, LOG_CATEGORIES.OAUTH_VALIDATION, message, metadata);
  }

  logScopeValidation(success, metadata = {}) {
    const level = success ? LOG_LEVELS.DEBUG : LOG_LEVELS.WARN;
    const message = success ? 'Scope validation passed' : 'Scope validation failed';
    return this.log(level, LOG_CATEGORIES.SCOPE_VALIDATION, message, metadata);
  }

  logTokenIntrospection(success, responseTime, metadata = {}) {
    const level = success ? LOG_LEVELS.DEBUG : LOG_LEVELS.ERROR;
    const message = success ? 'Token introspection successful' : 'Token introspection failed';
    return this.log(level, LOG_CATEGORIES.TOKEN_INTROSPECTION, message, {
      response_time_ms: responseTime,
      ...metadata
    });
  }

  logProviderHealth(healthy, responseTime, metadata = {}) {
    const level = healthy ? LOG_LEVELS.INFO : LOG_LEVELS.ERROR;
    const message = healthy ? 'OAuth provider healthy' : 'OAuth provider unhealthy';
    return this.log(level, LOG_CATEGORIES.PROVIDER_HEALTH, message, {
      response_time_ms: responseTime,
      ...metadata
    });
  }

  logAuthenticationAttempt(success, metadata = {}) {
    const level = success ? LOG_LEVELS.INFO : LOG_LEVELS.WARN;
    const message = success ? 'Authentication successful' : 'Authentication failed';
    return this.log(level, LOG_CATEGORIES.AUTHENTICATION, message, metadata);
  }

  logAuthorizationAttempt(success, metadata = {}) {
    const level = success ? LOG_LEVELS.DEBUG : LOG_LEVELS.WARN;
    const message = success ? 'Authorization granted' : 'Authorization denied';
    return this.log(level, LOG_CATEGORIES.AUTHORIZATION, message, metadata);
  }

  logErrorHandling(errorType, metadata = {}) {
    return this.log(LOG_LEVELS.ERROR, LOG_CATEGORIES.ERROR_HANDLING, `Error handled: ${errorType}`, metadata);
  }
}

// Create singleton instance
const logger = new StructuredLogger();

module.exports = {
  logger,
  LOG_LEVELS,
  LOG_CATEGORIES,
  StructuredLogger
};