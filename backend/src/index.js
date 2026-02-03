"use strict";

require("dotenv").config();

const { ServiceBroker } = require("moleculer");
const config = require("./config/moleculer.config");
const { middleware } = require("./lib");

/**
 * Main entry point for the betting platform
 * Starts the Moleculer broker and loads all services
 */
async function main() {
  // Create broker with middleware
  const broker = new ServiceBroker({
    ...config,
    middlewares: [
      ...config.middlewares,
      middleware.RequestContextMiddleware,
      middleware.ErrorHandlerMiddleware,
      middleware.ValidationMiddleware,
    ],
  });

  try {
    // Load services from the services directory
    // Services will be loaded as they are created
    broker.loadServices("./src/services", "**/*.service.js");

    // Start the broker
    await broker.start();

    broker.logger.info("All services started successfully");

    // Graceful shutdown
    const shutdown = async (signal) => {
      broker.logger.info(`Received ${signal}, shutting down gracefully...`);

      try {
        await broker.stop();
        process.exit(0);
      } catch (error) {
        broker.logger.error("Error during shutdown:", error);
        process.exit(1);
      }
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    // Handle uncaught errors
    process.on("uncaughtException", (error) => {
      broker.logger.fatal("Uncaught exception:", error);
      shutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason, promise) => {
      broker.logger.error("Unhandled rejection at:", promise, "reason:", reason);
    });
  } catch (error) {
    broker.logger.fatal("Failed to start services:", error);
    process.exit(1);
  }
}

main();
