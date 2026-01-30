"use strict";

const { MoleculerError, MoleculerClientError } = require("moleculer").Errors;

/**
 * Base application error
 */
class AppError extends MoleculerError {
  constructor(message, code = 500, type = "APP_ERROR", data = {}) {
    super(message, code, type, data);
    this.retryable = code >= 500;
  }
}

/**
 * Validation error for invalid input
 */
class ValidationError extends MoleculerClientError {
  constructor(message, data = {}) {
    super(message, 400, "VALIDATION_ERROR", data);
    this.retryable = false;
  }
}

/**
 * Authentication error
 */
class AuthenticationError extends MoleculerClientError {
  constructor(message = "Authentication required", data = {}) {
    super(message, 401, "AUTHENTICATION_ERROR", data);
    this.retryable = false;
  }
}

/**
 * Authorization error
 */
class AuthorizationError extends MoleculerClientError {
  constructor(message = "Access denied", data = {}) {
    super(message, 403, "AUTHORIZATION_ERROR", data);
    this.retryable = false;
  }
}

/**
 * Resource not found error
 */
class NotFoundError extends MoleculerClientError {
  constructor(message = "Resource not found", data = {}) {
    super(message, 404, "NOT_FOUND", data);
    this.retryable = false;
  }
}

/**
 * Conflict error (e.g., duplicate entry)
 */
class ConflictError extends MoleculerClientError {
  constructor(message = "Resource conflict", data = {}) {
    super(message, 409, "CONFLICT_ERROR", data);
    this.retryable = false;
  }
}

/**
 * Rate limit exceeded error
 */
class RateLimitError extends MoleculerClientError {
  constructor(message = "Rate limit exceeded", data = {}) {
    super(message, 429, "RATE_LIMIT_ERROR", data);
    this.retryable = true;
  }
}

/**
 * Insufficient funds error for wallet operations
 */
class InsufficientFundsError extends MoleculerClientError {
  constructor(message = "Insufficient funds", data = {}) {
    super(message, 400, "INSUFFICIENT_FUNDS", data);
    this.retryable = false;
  }
}

/**
 * Bet placement error
 */
class BetPlacementError extends MoleculerClientError {
  constructor(message = "Unable to place bet", data = {}) {
    super(message, 400, "BET_PLACEMENT_ERROR", data);
    this.retryable = false;
  }
}

/**
 * Odds changed error (market moved)
 */
class OddsChangedError extends MoleculerClientError {
  constructor(message = "Odds have changed", data = {}) {
    super(message, 409, "ODDS_CHANGED", data);
    this.retryable = true;
  }
}

/**
 * Market suspended error
 */
class MarketSuspendedError extends MoleculerClientError {
  constructor(message = "Market is suspended", data = {}) {
    super(message, 400, "MARKET_SUSPENDED", data);
    this.retryable = false;
  }
}

/**
 * Service unavailable error
 */
class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporarily unavailable", data = {}) {
    super(message, 503, "SERVICE_UNAVAILABLE", data);
    this.retryable = true;
  }
}

/**
 * Database error
 */
class DatabaseError extends AppError {
  constructor(message = "Database error", data = {}) {
    super(message, 500, "DATABASE_ERROR", data);
    this.retryable = true;
  }
}

/**
 * External service error
 */
class ExternalServiceError extends AppError {
  constructor(message = "External service error", data = {}) {
    super(message, 502, "EXTERNAL_SERVICE_ERROR", data);
    this.retryable = true;
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InsufficientFundsError,
  BetPlacementError,
  OddsChangedError,
  MarketSuspendedError,
  ServiceUnavailableError,
  DatabaseError,
  ExternalServiceError,
};
