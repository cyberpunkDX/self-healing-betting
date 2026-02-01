"use strict";

require("dotenv").config();

const { ServiceBroker } = require("moleculer");
const EventService = require("./event.service");
const config = require("../../config/moleculer.config");

/**
 * Standalone entry point for Event service
 */
async function main() {
  const broker = new ServiceBroker({
    ...config,
    nodeID: process.env.NODE_ID || "event-service-node",
  });

  // Create service instance
  broker.createService(EventService);

  try {
    await broker.start();
    broker.logger.info("Event service is running");
  } catch (error) {
    broker.logger.fatal("Failed to start Event service:", error);
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
