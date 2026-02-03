"use strict";

require("dotenv").config();

const { ServiceBroker } = require("moleculer");
const OddsService = require("./odds.service");
const config = require("../../config/moleculer.config");

/**
 * Standalone entry point for Odds service
 */
async function main() {
  const broker = new ServiceBroker({
    ...config,
    nodeID: process.env.NODE_ID || "odds-service-node",
  });

  // Create service instance
  broker.createService(OddsService);

  try {
    await broker.start();
    broker.logger.info("Odds service is running");
  } catch (error) {
    broker.logger.fatal("Failed to start Odds service:", error);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal) => {
    broker.logger.info(`Received ${signal}, shutting down...`);
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
}

main();
