"use strict";

require("dotenv").config();

const { ServiceBroker } = require("moleculer");
const WalletService = require("./wallet.service");
const config = require("../../config/moleculer.config");

/**
 * Standalone entry point for Wallet service
 */
async function main() {
  const broker = new ServiceBroker({
    ...config,
    nodeID: process.env.NODE_ID || "wallet-service-node",
  });

  // Create service instance
  broker.createService(WalletService);

  try {
    await broker.start();
    broker.logger.info("Wallet service is running");
  } catch (error) {
    broker.logger.fatal("Failed to start Wallet service:", error);
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
