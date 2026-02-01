"use strict";

/**
 * Moleculer REPL for interactive testing
 * Run with: node repl.js
 */

require("dotenv").config();

const { ServiceBroker } = require("moleculer");
const config = require("./src/config/moleculer.config");

// Import all services
const HealthMonitorService = require("./src/services/health-monitor/health-monitor.service");
const UserService = require("./src/services/user-service/user.service");
const WalletService = require("./src/services/wallet-service/wallet.service");
const EventService = require("./src/services/event-service/event.service");
const OddsService = require("./src/services/odds-service/odds.service");

async function main() {
  const broker = new ServiceBroker({
    ...config,
    nodeID: "repl-node",
    replCommands: [
      // Custom REPL commands
      {
        command: "test-user",
        description: "Create a test user and wallet",
        async action(broker, args) {
          const result = await broker.call("user.register", {
            email: "test@example.com",
            password: "password123",
            username: "testuser",
          });
          console.log("User created:", result);
        },
      },
      {
        command: "test-deposit <userId> <amount>",
        description: "Deposit to a wallet",
        async action(broker, args) {
          const result = await broker.call("wallet.deposit", {
            amount: parseFloat(args.amount),
            paymentMethod: "card",
          }, { meta: { userId: args.userId } });
          console.log("Deposit result:", result);
        },
      },
      {
        command: "list-events",
        description: "List upcoming events",
        async action(broker, args) {
          const result = await broker.call("event.upcoming", { limit: 10 });
          console.log("Events:", JSON.stringify(result, null, 2));
        },
      },
      {
        command: "list-sports",
        description: "List available sports from odds provider",
        async action(broker, args) {
          const result = await broker.call("odds.sports");
          console.log("Sports:", JSON.stringify(result, null, 2));
        },
      },
      {
        command: "health",
        description: "Check system health",
        async action(broker, args) {
          const result = await broker.call("health-monitor.status");
          console.log("Health:", JSON.stringify(result, null, 2));
        },
      },
    ],
  });

  // Load all services
  broker.createService(HealthMonitorService);
  broker.createService(UserService);
  broker.createService(WalletService);
  broker.createService(EventService);
  broker.createService(OddsService);

  await broker.start();

  // Start REPL
  broker.repl();
}

main().catch(console.error);
