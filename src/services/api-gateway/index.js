"use strict";

require("dotenv").config();

const { ServiceBroker } = require("moleculer");
const ApiGatewayService = require("./api-gateway.service");
const config = require("../../config/moleculer.config");

/**
 * Standalone entry point for API Gateway service
 */
async function main() {
  const broker = new ServiceBroker({
    ...config,
    nodeID: process.env.NODE_ID || "api-gateway-node",
  });

  // Create service instance
  broker.createService(ApiGatewayService);

  try {
    await broker.start();
    broker.logger.info("API Gateway service is running");
  } catch (error) {
    broker.logger.fatal("Failed to start API Gateway service:", error);
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
