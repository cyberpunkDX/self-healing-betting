"use strict";

const { v4: uuidv4 } = require("uuid");

/**
 * Request context middleware
 * Adds request ID and timing to all service calls
 */
const RequestContextMiddleware = {
  name: "RequestContext",

  localAction(next, action) {
    return async function requestContextMiddleware(ctx) {
      // Add request ID if not present
      if (!ctx.meta.requestId) {
        ctx.meta.requestId = uuidv4();
      }

      // Add timing
      ctx.meta.startTime = Date.now();

      try {
        const result = await next(ctx);

        // Log successful call duration
        const duration = Date.now() - ctx.meta.startTime;
        if (duration > 1000) {
          ctx.broker.logger.warn(
            `Slow action: ${action.name} took ${duration}ms`,
            { requestId: ctx.meta.requestId }
          );
        }

        return result;
      } catch (error) {
        // Add context to error
        error.requestId = ctx.meta.requestId;
        throw error;
      }
    };
  },
};

/**
 * Error handler middleware
 * Standardizes error responses and logging
 */
const ErrorHandlerMiddleware = {
  name: "ErrorHandler",

  localAction(next, action) {
    return async function errorHandlerMiddleware(ctx) {
      try {
        return await next(ctx);
      } catch (error) {
        // Log error with context
        ctx.broker.logger.error(`Error in ${action.name}:`, {
          error: error.message,
          code: error.code,
          type: error.type,
          requestId: ctx.meta.requestId,
          params: ctx.params,
        });

        // Rethrow for Moleculer error handling
        throw error;
      }
    };
  },
};

/**
 * Validation middleware
 * Validates action parameters using Joi schemas
 */
const ValidationMiddleware = {
  name: "Validation",

  localAction(next, action) {
    // Check if action has a Joi schema defined
    if (!action.schema) {
      return next;
    }

    return async function validationMiddleware(ctx) {
      const { error, value } = action.schema.validate(ctx.params, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        const { ValidationError } = require("../utils/errors");
        const errors = error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        }));

        throw new ValidationError("Validation failed", { errors });
      }

      // Replace params with validated/sanitized values
      ctx.params = value;

      return next(ctx);
    };
  },
};

/**
 * Cache buster middleware
 * Allows bypassing cache with meta.noCache flag
 */
const CacheBusterMiddleware = {
  name: "CacheBuster",

  localAction(next, action) {
    return async function cacheBusterMiddleware(ctx) {
      if (ctx.meta.noCache) {
        ctx.meta.$cache = false;
      }
      return next(ctx);
    };
  },
};

/**
 * Rate limiting middleware (per-action)
 * Tracks call counts and enforces limits
 */
const RateLimitMiddleware = {
  name: "RateLimit",

  created(broker) {
    this.limits = new Map();
  },

  localAction(next, action) {
    const middleware = this;

    // Check if action has rate limit defined
    if (!action.rateLimit) {
      return next;
    }

    const { calls, period } = action.rateLimit;

    return async function rateLimitMiddleware(ctx) {
      const userId = ctx.meta.userId || ctx.meta.requestId || "anonymous";
      const key = `${action.name}:${userId}`;

      // Get or create limit tracker
      let tracker = middleware.limits.get(key);
      const now = Date.now();

      if (!tracker || now - tracker.startTime > period) {
        tracker = { count: 0, startTime: now };
        middleware.limits.set(key, tracker);
      }

      tracker.count++;

      if (tracker.count > calls) {
        const { RateLimitError } = require("../utils/errors");
        throw new RateLimitError("Rate limit exceeded", {
          limit: calls,
          period,
          retryAfter: Math.ceil((tracker.startTime + period - now) / 1000),
        });
      }

      return next(ctx);
    };
  },
};

module.exports = {
  RequestContextMiddleware,
  ErrorHandlerMiddleware,
  ValidationMiddleware,
  CacheBusterMiddleware,
  RateLimitMiddleware,

  // Convenience export of all middlewares as array
  all: [
    RequestContextMiddleware,
    ErrorHandlerMiddleware,
    ValidationMiddleware,
    CacheBusterMiddleware,
    RateLimitMiddleware,
  ],
};
