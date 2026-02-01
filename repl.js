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
const BetService = require("./src/services/bet-service/bet.service");
const SettlementService = require("./src/services/settlement-service/settlement.service");
const NotificationService = require("./src/services/notification-service/notification.service");

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
          return result;
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
          return result;
        },
      },
      {
        command: "test-bet <userId> <stake>",
        description: "Place a test bet",
        async action(broker, args) {
          // Get first available event and selection
          const events = await broker.call("event.upcoming", { limit: 1 });
          if (!events.items || events.items.length === 0) {
            console.log("No events available");
            return;
          }

          const event = events.items[0];
          const market = event.markets?.[0];
          const selection = market?.selections?.[0];

          if (!selection) {
            console.log("No selections available");
            return;
          }

          const result = await broker.call("bet.place", {
            eventId: event.id,
            marketId: market.id,
            selectionId: selection.id,
            odds: selection.odds,
            stake: parseFloat(args.stake),
          }, { meta: { userId: args.userId } });

          console.log("Bet placed:", result);
          return result;
        },
      },
      {
        command: "list-events",
        description: "List upcoming events",
        async action(broker, args) {
          const result = await broker.call("event.upcoming", { limit: 10 });
          console.log("Events:", JSON.stringify(result, null, 2));
          return result;
        },
      },
      {
        command: "list-sports",
        description: "List available sports from odds provider",
        async action(broker, args) {
          const result = await broker.call("odds.sports");
          console.log("Sports:", JSON.stringify(result, null, 2));
          return result;
        },
      },
      {
        command: "open-bets <userId>",
        description: "List open bets for a user",
        async action(broker, args) {
          const result = await broker.call("bet.openBets", {}, { meta: { userId: args.userId } });
          console.log("Open bets:", JSON.stringify(result, null, 2));
          return result;
        },
      },
      {
        command: "health",
        description: "Check system health",
        async action(broker, args) {
          const result = await broker.call("health-monitor.status");
          console.log("Health:", JSON.stringify(result, null, 2));
          return result;
        },
      },
      {
        command: "services",
        description: "List all registered services",
        async action(broker, args) {
          const result = await broker.call("health-monitor.services");
          console.log("Services:", JSON.stringify(result, null, 2));
          return result;
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
  broker.createService(BetService);
  broker.createService(SettlementService);
  broker.createService(NotificationService);

  await broker.start();

  console.log("\n========================================");
  console.log("  Self-Healing Betting Platform REPL");
  console.log("========================================");
  console.log("\nCustom commands:");
  console.log("  test-user              - Create a test user");
  console.log("  test-deposit <id> <amt>- Deposit to wallet");
  console.log("  test-bet <id> <stake>  - Place a test bet");
  console.log("  list-events            - List upcoming events");
  console.log("  list-sports            - List available sports");
  console.log("  open-bets <userId>     - List open bets");
  console.log("  health                 - Check system health");
  console.log("  services               - List all services");
  console.log("\nMoleculer commands:");
  console.log("  call <action> [params] - Call a service action");
  console.log("  dcall <action> [params]- Call with debug");
  console.log("  emit <event> [payload] - Emit an event");
  console.log("  nodes                  - List nodes");
  console.log("  actions                - List all actions");
  console.log("  exit                   - Exit REPL\n");

  // Start REPL
  broker.repl();
}

main().catch(console.error);
