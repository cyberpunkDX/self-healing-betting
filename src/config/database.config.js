"use strict";

require("dotenv").config();

/**
 * Database configuration for PostgreSQL
 */
module.exports = {
  // Connection URL (takes precedence if set)
  url: process.env.DATABASE_URL || null,

  // Individual connection parameters
  connection: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || "betting",
    username: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    dialect: "postgres",
  },

  // Connection pool settings
  pool: {
    min: parseInt(process.env.DB_POOL_MIN, 10) || 5,
    max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
    acquire: 30000, // Max time (ms) to acquire connection
    idle: 10000,    // Max time (ms) connection can be idle
    evict: 1000,    // How often to check for idle connections
  },

  // Sequelize options
  options: {
    logging: process.env.DB_LOGGING === "true" ? console.log : false,
    benchmark: process.env.NODE_ENV === "development",

    // Timezone
    timezone: "+00:00",

    // Query options
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true,
      charset: "utf8",
      collate: "utf8_general_ci",
    },

    // Retry on connection errors
    retry: {
      max: 3,
      match: [
        /SequelizeConnectionError/,
        /SequelizeConnectionRefusedError/,
        /SequelizeHostNotFoundError/,
        /SequelizeHostNotReachableError/,
        /SequelizeInvalidConnectionError/,
        /SequelizeConnectionTimedOutError/,
      ],
    },
  },

  // Read replica configuration (for production scaling)
  replication: {
    enabled: process.env.DB_REPLICATION_ENABLED === "true",
    write: {
      host: process.env.DB_WRITE_HOST || process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_WRITE_PORT, 10) || parseInt(process.env.DB_PORT, 10) || 5432,
      username: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "postgres",
    },
    read: process.env.DB_READ_HOSTS
      ? process.env.DB_READ_HOSTS.split(",").map((host) => ({
          host: host.trim(),
          port: parseInt(process.env.DB_READ_PORT, 10) || parseInt(process.env.DB_PORT, 10) || 5432,
          username: process.env.DB_USER || "postgres",
          password: process.env.DB_PASSWORD || "postgres",
        }))
      : [],
  },

  // Migration settings
  migrations: {
    path: "./src/migrations",
    pattern: /^\d+[\w-]+\.js$/,
  },

  // Seeder settings
  seeders: {
    path: "./src/seeders",
  },
};
