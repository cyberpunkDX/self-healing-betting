"use strict";

require("dotenv").config();

/**
 * Redis configuration for caching and pub/sub
 */
module.exports = {
  // Connection URL
  url: process.env.REDIS_URL || "redis://localhost:6379",

  // Connection options
  connection: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB, 10) || 0,

    // Connection pool settings
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,

    // Reconnection settings
    retryStrategy: (times) => {
      if (times > 10) {
        return null; // Stop retrying after 10 attempts
      }
      return Math.min(times * 100, 3000); // Exponential backoff, max 3s
    },

    // Connection timeout
    connectTimeout: 10000,

    // Keep alive
    keepAlive: 30000,
  },

  // Cache TTL defaults (in seconds)
  ttl: {
    default: 30,
    session: 86400,      // 24 hours
    odds: 1,             // 1 second for real-time odds
    userProfile: 300,    // 5 minutes
    eventList: 60,       // 1 minute
    betStatus: 10,       // 10 seconds
  },

  // Key prefixes for namespacing
  prefixes: {
    session: "session:",
    cache: "cache:",
    odds: "odds:",
    bet: "bet:",
    user: "user:",
    event: "event:",
    lock: "lock:",
    pubsub: "pubsub:",
  },

  // Cluster configuration (for production)
  cluster: {
    enabled: process.env.REDIS_CLUSTER_ENABLED === "true",
    nodes: process.env.REDIS_CLUSTER_NODES
      ? process.env.REDIS_CLUSTER_NODES.split(",").map((node) => {
          const [host, port] = node.split(":");
          return { host, port: parseInt(port, 10) };
        })
      : [],
    options: {
      scaleReads: "slave",
      maxRedirections: 16,
      retryDelayOnFailover: 100,
    },
  },
};
