"use strict";

const winston = require("winston");

const { combine, timestamp, printf, colorize, errors } = winston.format;

/**
 * Custom log format for structured logging
 */
const logFormat = printf(({ level, message, timestamp, service, requestId, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  const serviceStr = service ? `[${service}]` : "";
  const reqIdStr = requestId ? `[${requestId}]` : "";

  return `${timestamp} ${level} ${serviceStr}${reqIdStr} ${message}${metaStr}`;
});

/**
 * Create a Winston logger instance
 */
const createLogger = (serviceName = "betting-platform") => {
  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    defaultMeta: { service: serviceName },
    format: combine(
      errors({ stack: true }),
      timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
      logFormat
    ),
    transports: [
      new winston.transports.Console({
        format: combine(
          colorize({ all: true }),
          timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
          logFormat
        ),
      }),
    ],
  });

  // Add file transports in production
  if (process.env.NODE_ENV === "production") {
    logger.add(
      new winston.transports.File({
        filename: "logs/error.log",
        level: "error",
        maxsize: 10485760, // 10MB
        maxFiles: 5,
      })
    );
    logger.add(
      new winston.transports.File({
        filename: "logs/combined.log",
        maxsize: 10485760, // 10MB
        maxFiles: 10,
      })
    );
  }

  return logger;
};

/**
 * Create a child logger with additional context
 */
const createChildLogger = (logger, context = {}) => {
  return logger.child(context);
};

/**
 * Request logger middleware for tracking request context
 */
const withRequestContext = (logger, requestId) => {
  return createChildLogger(logger, { requestId });
};

module.exports = {
  createLogger,
  createChildLogger,
  withRequestContext,
};
