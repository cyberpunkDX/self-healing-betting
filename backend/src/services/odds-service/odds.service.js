"use strict";

const { Service } = require("moleculer");
const { v4: uuidv4 } = require("uuid");
const { createProvider } = require("./providers");

/**
 * Odds Service
 * Handles real-time odds management via external feed providers
 */
module.exports = class OddsService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: "odds",

      settings: {
        // Provider configuration
        provider: process.env.ODDS_PROVIDER || "the-odds-api",
        providerConfig: {
          apiKey: process.env.ODDS_API_KEY,
          region: process.env.ODDS_API_REGION || "us",
          preferredBookmaker: process.env.ODDS_API_BOOKMAKER || "pinnacle",
          pollInterval: parseInt(process.env.ODDS_POLL_INTERVAL, 10) || 30000,
        },

        // Sync interval for fetching odds from provider
        syncInterval: parseInt(process.env.ODDS_SYNC_INTERVAL, 10) || 60000,

        // Sports to sync (The Odds API sport keys)
        sportsToSync: (process.env.ODDS_SPORTS || "soccer_epl,basketball_nba").split(","),

        // Odds constraints
        minOdds: 1.01,
        maxOdds: 1000,

        // Fallback to mock provider if API key not set
        useMockFallback: process.env.NODE_ENV === "development",
      },

      metadata: {
        description: "Real-time odds management via external feed providers",
        version: "2.0.0",
      },

      dependencies: [],

      actions: {
        /**
         * Get current odds for a selection
         */
        get: {
          rest: "GET /selection/:selectionId",
          params: {
            selectionId: { type: "string" },
          },
          cache: { keys: ["selectionId"], ttl: 1 },
          async handler(ctx) {
            const odds = this.getOdds(ctx.params.selectionId);
            if (!odds) {
              throw new this.broker.MoleculerClientError("Odds not found", 404, "ODDS_NOT_FOUND");
            }
            return odds;
          },
        },

        /**
         * Get odds for multiple selections
         */
        getBulk: {
          rest: "POST /bulk",
          params: {
            selectionIds: { type: "array", items: "string" },
          },
          async handler(ctx) {
            const results = {};
            for (const selectionId of ctx.params.selectionIds) {
              const odds = this.getOdds(selectionId);
              if (odds) {
                results[selectionId] = odds;
              }
            }
            return results;
          },
        },

        /**
         * Get odds for all selections in a market
         */
        market: {
          rest: "GET /market/:marketId",
          params: {
            marketId: { type: "string" },
          },
          cache: { keys: ["marketId"], ttl: 1 },
          async handler(ctx) {
            return this.getOddsByMarket(ctx.params.marketId);
          },
        },

        /**
         * Get odds for all markets in an event
         */
        event: {
          rest: "GET /event/:eventId",
          params: {
            eventId: { type: "string" },
          },
          cache: { keys: ["eventId"], ttl: 1 },
          async handler(ctx) {
            return this.getOddsByEvent(ctx.params.eventId);
          },
        },

        /**
         * Get available sports from provider
         */
        sports: {
          rest: "GET /sports",
          cache: { keys: [], ttl: 300 },
          async handler(ctx) {
            return this.provider.getSports();
          },
        },

        /**
         * Get events with odds for a sport
         */
        sportEvents: {
          rest: "GET /sports/:sportKey/events",
          params: {
            sportKey: { type: "string" },
          },
          cache: { keys: ["sportKey"], ttl: 30 },
          async handler(ctx) {
            return this.provider.getOdds(ctx.params.sportKey);
          },
        },

        /**
         * Force sync odds from provider
         */
        sync: {
          rest: "POST /sync",
          visibility: "protected",
          async handler(ctx) {
            return this.syncFromProvider();
          },
        },

        /**
         * Get odds history for a selection
         */
        history: {
          rest: "GET /selection/:selectionId/history",
          params: {
            selectionId: { type: "string" },
            limit: { type: "number", integer: true, min: 1, max: 100, default: 20, optional: true },
          },
          async handler(ctx) {
            const { selectionId, limit } = ctx.params;
            return this.getOddsHistory(selectionId, limit);
          },
        },

        /**
         * Validate odds for bet placement
         */
        validate: {
          params: {
            selectionId: { type: "string" },
            expectedOdds: { type: "number", positive: true },
            tolerance: { type: "number", min: 0, max: 0.1, default: 0.05, optional: true },
          },
          async handler(ctx) {
            const { selectionId, expectedOdds, tolerance } = ctx.params;
            return this.validateOdds(selectionId, expectedOdds, tolerance);
          },
        },

        /**
         * Calculate combined odds for accumulator
         */
        calculateAccumulator: {
          params: {
            selectionIds: { type: "array", items: "string", min: 2 },
          },
          async handler(ctx) {
            return this.calculateAccumulatorOdds(ctx.params.selectionIds);
          },
        },

        /**
         * Get provider status
         */
        providerStatus: {
          rest: "GET /provider/status",
          async handler(ctx) {
            return this.provider.getStatus();
          },
        },

        /**
         * Ping for health checks
         */
        ping: {
          async handler() {
            return {
              status: "ok",
              service: "odds",
              provider: this.provider.name,
              connected: this.provider.isConnected,
              timestamp: Date.now(),
            };
          },
        },
      },

      events: {
        /**
         * Handle market status change
         */
        "market.statusChanged"(ctx) {
          const { marketId, status } = ctx.params;
          if (status === "suspended") {
            this.suspendMarketOdds(marketId);
          } else if (status === "open") {
            this.resumeMarketOdds(marketId);
          }
        },

        /**
         * Handle event going live - subscribe to live updates
         */
        "event.statusChanged"(ctx) {
          const { eventId, newStatus } = ctx.params;
          if (newStatus === "live") {
            this.subscribeToLiveUpdates(eventId);
          } else if (newStatus === "finished" || newStatus === "cancelled") {
            this.unsubscribeFromLiveUpdates(eventId);
            this.suspendEventOdds(eventId);
          }
        },
      },

      methods: {
        /**
         * Get odds for a selection
         */
        getOdds(selectionId) {
          const oddsData = this.oddsStore.get(selectionId);
          if (!oddsData) return null;

          return {
            selectionId,
            odds: oddsData.odds,
            previousOdds: oddsData.previousOdds,
            status: oddsData.status,
            lastUpdate: oddsData.lastUpdate,
            movement: this.calculateMovement(oddsData.odds, oddsData.previousOdds),
            source: this.provider.name,
          };
        },

        /**
         * Get odds by market
         */
        getOddsByMarket(marketId) {
          const selections = [];
          for (const [selectionId, oddsData] of this.oddsStore.entries()) {
            if (oddsData.marketId === marketId) {
              selections.push({
                selectionId,
                name: oddsData.name,
                odds: oddsData.odds,
                previousOdds: oddsData.previousOdds,
                status: oddsData.status,
                movement: this.calculateMovement(oddsData.odds, oddsData.previousOdds),
              });
            }
          }
          return { marketId, selections };
        },

        /**
         * Get odds by event
         */
        getOddsByEvent(eventId) {
          const markets = new Map();

          for (const [selectionId, oddsData] of this.oddsStore.entries()) {
            if (oddsData.eventId === eventId) {
              if (!markets.has(oddsData.marketId)) {
                markets.set(oddsData.marketId, {
                  marketId: oddsData.marketId,
                  marketName: oddsData.marketName,
                  marketType: oddsData.marketType,
                  selections: [],
                });
              }
              markets.get(oddsData.marketId).selections.push({
                selectionId,
                name: oddsData.name,
                odds: oddsData.odds,
                previousOdds: oddsData.previousOdds,
                status: oddsData.status,
                movement: this.calculateMovement(oddsData.odds, oddsData.previousOdds),
              });
            }
          }

          return {
            eventId,
            source: this.provider.name,
            markets: Array.from(markets.values()),
          };
        },

        /**
         * Sync odds from external provider
         */
        async syncFromProvider() {
          const syncResults = {
            sports: [],
            eventsProcessed: 0,
            selectionsUpdated: 0,
            errors: [],
          };

          for (const sportKey of this.settings.sportsToSync) {
            try {
              const eventsWithOdds = await this.provider.getOdds(sportKey);

              for (const event of eventsWithOdds) {
                syncResults.eventsProcessed++;

                // Store event mapping
                this.eventMapping.set(event.id, {
                  externalId: event.externalId || event.id,
                  sportKey,
                  name: event.name,
                  homeTeam: event.homeTeam,
                  awayTeam: event.awayTeam,
                  startTime: event.startTime,
                });

                // Process markets and selections
                for (const market of event.markets || []) {
                  for (const selection of market.selections || []) {
                    const updated = this.updateOddsFromProvider(
                      selection.id,
                      selection.odds,
                      {
                        name: selection.name,
                        marketId: market.id,
                        marketName: market.name,
                        marketType: market.type,
                        eventId: event.id,
                        eventName: event.name,
                        sportKey,
                      }
                    );
                    if (updated) syncResults.selectionsUpdated++;
                  }
                }
              }

              syncResults.sports.push({ sportKey, events: eventsWithOdds.length });
            } catch (error) {
              this.logger.error(`Failed to sync sport ${sportKey}:`, error.message);
              syncResults.errors.push({ sportKey, error: error.message });
            }
          }

          this.logger.info(
            `Odds sync complete: ${syncResults.eventsProcessed} events, ${syncResults.selectionsUpdated} selections updated`
          );

          return syncResults;
        },

        /**
         * Update odds from provider data
         */
        updateOddsFromProvider(selectionId, newOdds, metadata) {
          const existing = this.oddsStore.get(selectionId);
          const previousOdds = existing?.odds || newOdds;

          // Skip if odds haven't changed
          if (existing && existing.odds === newOdds) {
            return false;
          }

          const oddsData = {
            odds: newOdds,
            previousOdds,
            name: metadata.name,
            marketId: metadata.marketId,
            marketName: metadata.marketName,
            marketType: metadata.marketType,
            eventId: metadata.eventId,
            eventName: metadata.eventName,
            sportKey: metadata.sportKey,
            status: "active",
            lastUpdate: new Date(),
          };

          this.oddsStore.set(selectionId, oddsData);

          // Record history
          const history = this.oddsHistory.get(selectionId) || [];
          history.unshift({
            odds: newOdds,
            previousOdds,
            timestamp: new Date(),
            source: this.provider.name,
          });
          if (history.length > 100) history.pop();
          this.oddsHistory.set(selectionId, history);

          // Emit update event if odds changed
          if (previousOdds !== newOdds) {
            this.broker.emit("odds.updated", {
              selectionId,
              marketId: metadata.marketId,
              eventId: metadata.eventId,
              odds: newOdds,
              previousOdds,
              movement: this.calculateMovement(newOdds, previousOdds),
              source: this.provider.name,
            });
          }

          return true;
        },

        /**
         * Subscribe to live odds updates for an event
         */
        async subscribeToLiveUpdates(eventId) {
          const eventData = this.eventMapping.get(eventId);
          if (!eventData) {
            this.logger.warn(`Cannot subscribe to live updates: event ${eventId} not found`);
            return;
          }

          try {
            const subscriptionId = await this.provider.subscribe(
              eventId,
              (updatedOdds) => {
                this.handleLiveOddsUpdate(updatedOdds);
              },
              eventData.sportKey
            );

            this.liveSubscriptions.set(eventId, subscriptionId);
            this.logger.info(`Subscribed to live updates for event ${eventId}`);
          } catch (error) {
            this.logger.error(`Failed to subscribe to live updates for ${eventId}:`, error.message);
          }
        },

        /**
         * Unsubscribe from live updates
         */
        async unsubscribeFromLiveUpdates(eventId) {
          const subscriptionId = this.liveSubscriptions.get(eventId);
          if (subscriptionId) {
            await this.provider.unsubscribe(subscriptionId);
            this.liveSubscriptions.delete(eventId);
            this.logger.info(`Unsubscribed from live updates for event ${eventId}`);
          }
        },

        /**
         * Handle live odds update from provider
         */
        handleLiveOddsUpdate(eventWithOdds) {
          for (const market of eventWithOdds.markets || []) {
            for (const selection of market.selections || []) {
              this.updateOddsFromProvider(selection.id, selection.odds, {
                name: selection.name,
                marketId: market.id,
                marketName: market.name,
                marketType: market.type,
                eventId: eventWithOdds.id,
                eventName: eventWithOdds.name,
                sportKey: eventWithOdds.sportKey,
              });
            }
          }
        },

        /**
         * Suspend all odds for a market
         */
        suspendMarketOdds(marketId) {
          for (const [selectionId, oddsData] of this.oddsStore.entries()) {
            if (oddsData.marketId === marketId) {
              oddsData.status = "suspended";
              oddsData.lastUpdate = new Date();
            }
          }
          this.broker.emit("odds.market.suspended", { marketId });
        },

        /**
         * Resume all odds for a market
         */
        resumeMarketOdds(marketId) {
          for (const [selectionId, oddsData] of this.oddsStore.entries()) {
            if (oddsData.marketId === marketId) {
              oddsData.status = "active";
              oddsData.lastUpdate = new Date();
            }
          }
          this.broker.emit("odds.market.resumed", { marketId });
        },

        /**
         * Suspend all odds for an event
         */
        suspendEventOdds(eventId) {
          for (const [selectionId, oddsData] of this.oddsStore.entries()) {
            if (oddsData.eventId === eventId) {
              oddsData.status = "suspended";
              oddsData.lastUpdate = new Date();
            }
          }
        },

        /**
         * Get odds history
         */
        getOddsHistory(selectionId, limit = 20) {
          const history = this.oddsHistory.get(selectionId) || [];
          return history.slice(0, limit);
        },

        /**
         * Validate odds for bet placement
         */
        validateOdds(selectionId, expectedOdds, tolerance = 0.05) {
          const oddsData = this.oddsStore.get(selectionId);
          if (!oddsData) {
            return { valid: false, reason: "Selection not found" };
          }

          if (oddsData.status !== "active") {
            return { valid: false, reason: "Odds are suspended", status: oddsData.status };
          }

          const currentOdds = oddsData.odds;
          const difference = Math.abs(currentOdds - expectedOdds) / expectedOdds;

          if (difference > tolerance) {
            return {
              valid: false,
              reason: "Odds have changed",
              expectedOdds,
              currentOdds,
              difference: (difference * 100).toFixed(2) + "%",
            };
          }

          return { valid: true, currentOdds };
        },

        /**
         * Calculate accumulator odds
         */
        calculateAccumulatorOdds(selectionIds) {
          let combinedOdds = 1;
          const selections = [];

          for (const selectionId of selectionIds) {
            const oddsData = this.oddsStore.get(selectionId);
            if (!oddsData) {
              throw new this.broker.MoleculerClientError(
                `Selection ${selectionId} not found`,
                404,
                "SELECTION_NOT_FOUND"
              );
            }
            if (oddsData.status !== "active") {
              throw new this.broker.MoleculerClientError(
                `Selection ${selectionId} is suspended`,
                400,
                "SELECTION_SUSPENDED"
              );
            }

            combinedOdds *= oddsData.odds;
            selections.push({
              selectionId,
              name: oddsData.name,
              odds: oddsData.odds,
              eventName: oddsData.eventName,
            });
          }

          return {
            selections,
            combinedOdds: Math.round(combinedOdds * 100) / 100,
            selectionCount: selectionIds.length,
          };
        },

        /**
         * Calculate movement indicator
         */
        calculateMovement(current, previous) {
          if (!previous || current === previous) return "stable";
          return current > previous ? "up" : "down";
        },

        /**
         * Start periodic sync timer
         */
        startSyncTimer() {
          this.syncTimer = setInterval(() => {
            this.syncFromProvider().catch((err) => {
              this.logger.error("Periodic sync failed:", err.message);
            });
          }, this.settings.syncInterval);
        },

        /**
         * Stop sync timer
         */
        stopSyncTimer() {
          if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
          }
        },
      },

      created() {
        this.oddsStore = new Map();
        this.oddsHistory = new Map();
        this.eventMapping = new Map();
        this.liveSubscriptions = new Map();
        this.syncTimer = null;
        this.provider = null;
      },

      async started() {
        // Initialize provider
        const providerType = this.settings.useMockFallback && !this.settings.providerConfig.apiKey
          ? "mock"
          : this.settings.provider;

        this.provider = createProvider(providerType, this.settings.providerConfig);

        try {
          await this.provider.initialize();
          this.logger.info(`Odds service started with provider: ${this.provider.name}`);

          // Initial sync
          await this.syncFromProvider();

          // Start periodic sync
          this.startSyncTimer();
        } catch (error) {
          this.logger.error("Failed to initialize odds provider:", error.message);

          // Fallback to mock if configured
          if (this.settings.useMockFallback) {
            this.logger.warn("Falling back to mock provider");
            this.provider = createProvider("mock", {});
            await this.provider.initialize();
          } else {
            throw error;
          }
        }
      },

      async stopped() {
        this.stopSyncTimer();

        // Unsubscribe from all live updates
        for (const eventId of this.liveSubscriptions.keys()) {
          await this.unsubscribeFromLiveUpdates(eventId);
        }

        if (this.provider) {
          await this.provider.disconnect();
        }

        this.logger.info("Odds service stopped");
      },
    });
  }
};
