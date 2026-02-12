/**
 * Frontend logging utility with different log levels.
 * 
 * Provides structured logging for better debugging and monitoring.
 * Includes console formatting and optional remote logging support.
 */

// ==================== LOG LEVELS ====================
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4,
};

// ==================== CONFIGURATION ====================
const config = {
  // Set minimum log level (DEBUG in dev, INFO in prod)
  minLevel: import.meta.env.DEV ? LogLevel.DEBUG : LogLevel.INFO,
  
  // Enable/disable console output
  enableConsole: true,
  
  // Enable/disable remote logging (future: send to backend)
  enableRemote: false,
  
  // Add timestamps to logs
  showTimestamp: true,
  
  // Show caller location (file, line)
  showLocation: import.meta.env.DEV,
};

// ==================== LOGGER CLASS ====================
class Logger {
  constructor(name = 'App') {
    this.name = name;
  }

  /**
   * Get formatted timestamp
   */
  _getTimestamp() {
    const now = new Date();
    return now.toISOString().replace('T', ' ').substring(0, 23);
  }

  /**
   * Get caller location (file and line number)
   */
  _getLocation() {
    if (!config.showLocation) return null;
    
    try {
      const stack = new Error().stack;
      const lines = stack.split('\n');
      // Skip first 3 lines (Error, this function, the log function)
      const callerLine = lines[3] || '';
      const match = callerLine.match(/\((.*):(\d+):(\d+)\)/);
      if (match) {
        const [, file, line] = match;
        const filename = file.split('/').pop();
        return `${filename}:${line}`;
      }
    } catch (e) {
      // Ignore errors in getting location
    }
    return null;
  }

  /**
   * Format log message with metadata
   */
  _formatMessage(level, message, data) {
    const parts = [];
    
    if (config.showTimestamp) {
      parts.push(`[${this._getTimestamp()}]`);
    }
    
    parts.push(`[${level}]`);
    parts.push(`[${this.name}]`);
    
    const location = this._getLocation();
    if (location) {
      parts.push(`(${location})`);
    }
    
    parts.push(message);
    
    return parts.join(' ');
  }

  /**
   * Log message with specific level
   */
  _log(level, levelName, message, data = {}) {
    if (level < config.minLevel) return;
    
    if (!config.enableConsole) return;
    
    const formattedMessage = this._formatMessage(levelName, message, data);
    
    // Console styling
    const styles = {
      DEBUG: 'color: #888',
      INFO: 'color: #0066cc',
      WARN: 'color: #ff9800; font-weight: bold',
      ERROR: 'color: #f44336; font-weight: bold',
    };
    
    // Log to console with styling
    if (Object.keys(data).length > 0) {
      console[levelName.toLowerCase()](
        `%c${formattedMessage}`,
        styles[levelName],
        data
      );
    } else {
      console[levelName.toLowerCase()](
        `%c${formattedMessage}`,
        styles[levelName]
      );
    }
    
    // TODO: Send to remote logging service if enabled
    if (config.enableRemote && level >= LogLevel.WARN) {
      this._sendToRemote(levelName, message, data);
    }
  }

  /**
   * Send log to remote service (placeholder for future implementation)
   */
  async _sendToRemote(level, message, data) {
    // TODO: Implement remote logging endpoint
    // Example: POST /api/logs with { level, message, data, timestamp }
  }

  /**
   * Debug level logging - verbose information for debugging
   */
  debug(message, data) {
    this._log(LogLevel.DEBUG, 'DEBUG', message, data);
  }

  /**
   * Info level logging - general information
   */
  info(message, data) {
    this._log(LogLevel.INFO, 'INFO', message, data);
  }

  /**
   * Warning level logging - non-critical issues
   */
  warn(message, data) {
    this._log(LogLevel.WARN, 'WARN', message, data);
  }

  /**
   * Error level logging - errors and exceptions
   */
  error(message, data) {
    this._log(LogLevel.ERROR, 'ERROR', message, data);
  }

  /**
   * Create a child logger with a different name
   */
  child(name) {
    return new Logger(`${this.name}:${name}`);
  }
}

// ==================== REQUEST LOGGER ====================
/**
 * Log API request with timing
 */
export class RequestLogger {
  constructor(operation, context = {}) {
    this.logger = new Logger('API');
    this.operation = operation;
    this.context = context;
    this.startTime = null;
    this.requestId = Math.random().toString(36).substring(2, 10);
  }

  start() {
    this.startTime = Date.now();
    this.logger.info(
      `→ ${this.operation}`,
      { request_id: this.requestId, ...this.context }
    );
    return this;
  }

  success(response, extraData = {}) {
    const duration = Date.now() - this.startTime;
    this.logger.info(
      `✓ ${this.operation} (${duration}ms)`,
      {
        request_id: this.requestId,
        duration_ms: duration,
        ...extraData,
      }
    );
    return response;
  }

  error(error, extraData = {}) {
    const duration = Date.now() - this.startTime;
    this.logger.error(
      `✗ ${this.operation} (${duration}ms)`,
      {
        request_id: this.requestId,
        duration_ms: duration,
        error: error.message,
        ...extraData,
      }
    );
    throw error;
  }
}

// ==================== EXPORTS ====================
// Create default logger instance
const defaultLogger = new Logger();

export default defaultLogger;
export { Logger, LogLevel };
