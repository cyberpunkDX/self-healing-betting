"use strict";

require("dotenv").config();

/**
 * Moleculer ServiceBroker configuration
 * Includes self-healing capabilities: circuit breakers, retries, bulkheads
 */
module.exports = {
  // Namespace for service isolation
  namespace: process.env.NAMESPACE || "betting",

  // Node ID (unique identifier for this node)
  nodeID: process.env.NODE_ID || null,

  // Logging configuration
  logger: {
    type: "Console",
    options: {
      level: process.env.LOG_LEVEL || "info",
      colors: true,
      moduleColors: true,
      formatter: "full",
      objectPrinter: null,
      autoPadding: false,
    },
  },

  // Transporter configuration (NATS for production, TCP for local)
  transporter: process.env.TRANSPORTER || "TCP",

  // Cacher configuration (Redis)
  cacher: process.env.CACHER
    ? {
        type: "Redis",
        options: {
          prefix: "betting:",
          ttl: 30,
          redis: process.env.REDIS_URL || "redis://localhost:6379",
        },
      }
    : null,

  // Serializer for message encoding
  serializer: "JSON",

  // Request timeout in milliseconds
  requestTimeout: 10000,

  // Retry policy for failed requests
  retryPolicy: {
    enabled: true,
    retries: 3,
    delay: 100,
    maxDelay: 1000,
    factor: 2,
    check: (err) => err && !!err.retryable,
  },

  // Circuit breaker settings
  circuitBreaker: {
    enabled: true,
    threshold: 0.5, // Trip when 50% of requests fail
    minRequestCount: 20, // Minimum requests before tripping
    windowTime: 60, // Time window in seconds
    halfOpenTime: 10000, // Time before trying again (ms)
    check: (err) => err && err.code >= 500,
  },

  // Bulkhead settings for isolation
  bulkhead: {
    enabled: true,
    concurrency: 10, // Max concurrent calls per action
    maxQueueSize: 100, // Max queued calls
  },

  // Request tracking
  tracking: {
    enabled: true,
    shutdownTimeout: 5000,
  },

  // Metrics configuration
  metrics: {
    enabled: true,
    reporter: [
      {
        type: "Console",
        options: {
          interval: 60000, // Report every 60 seconds
          logger: null,
          colors: true,
          onlyChanges: true,
        },
      },
    ],
  },

  // Tracing configuration
  tracing: {
    enabled: true,
    exporter: {
      type: "Console",
      options: {
        logger: null,
        colors: true,
        width: 100,
        gaugeWidth: 40,
      },
    },
  },

  // Validator configuration
  validator: true,

  // Error handler
  errorHandler: null,

  // Middleware list
  middlewares: [],

  // Service dependencies timeout
  dependencyTimeout: 0,

  // Watch for service file changes (development)
  hotReload: process.env.NODE_ENV === "development",

  // Registry configuration
  registry: {
    strategy: "RoundRobin",
    preferLocal: true,
    discoverer: {
      type: "Local",
      options: {
        heartbeatInterval: 10,
        heartbeatTimeout: 30,
        disableHeartbeatChecks: false,
        disableOfflineNodeRemoving: false,
        cleanOfflineNodesTimeout: 600,
      },
    },
  },

  // Internal services configuration
  internalServices: true,
  internalMiddlewares: true,

  // Called after broker started
  started(broker) {
    broker.logger.info("===========================================");
    broker.logger.info(`Betting Platform Node Started: ${broker.nodeID}`);
    broker.logger.info(`Namespace: ${broker.namespace}`);
    broker.logger.info(`Transporter: ${broker.options.transporter}`);
    broker.logger.info("===========================================");
  },

  // Called after broker stopped
  stopped(broker) {
    broker.logger.info(`Betting Platform Node Stopped: ${broker.nodeID}`);
  },

  // Replicate context params to sub-calls
  contextParamsCloning: false,

  // Maximum call level for nested calls
  maxCallLevel: 100,

  // Heartbeat interval in seconds
  heartbeatInterval: 10,

  // Heartbeat timeout in seconds
  heartbeatTimeout: 30,
};
