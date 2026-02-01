"use strict";

const { Service } = require("moleculer");
const { v4: uuidv4 } = require("uuid");

/**
 * Settlement Service
 * Handles bet resolution and payout processing
 */
module.exports = class SettlementService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: "settlement",

      settings: {
        batchSize: parseInt(process.env.SETTLEMENT_BATCH_SIZE, 10) || 1000,
        processInterval: parseInt(process.env.SETTLEMENT_INTERVAL, 10) || 5000,
        retryAttempts: 3,
        retryDelay: 1000,
      },

      metadata: {
        description: "Bet settlement and payout processing",
        version: "1.0.0",
      },

      dependencies: ["bet", "event", "wallet"],

      actions: {
        /**
         * Settle a market
         */
        settleMarket: {
          params: {
            marketId: { type: "string" },
            results: {
              type: "array",
              items: {
                type: "object",
                props: {
                  selectionId: { type: "string" },
                  result: { type: "string", enum: ["winner", "loser", "void", "push"] },
                },
              },
            },
          },
          visibility: "protected",
          async handler(ctx) {
            const { marketId, results } = ctx.params;

            this.logger.info(`Settling market ${marketId} with ${results.length} results`);

            const settlementId = uuidv4();
            const settlement = {
              id: settlementId,
              marketId,
              results,
              status: "processing",
              processedSelections: 0,
              affectedBets: 0,
              startedAt: new Date(),
              completedAt: null,
              errors: [],
            };

            this.settlements.set(settlementId, settlement);

            // Process each selection result
            for (const result of results) {
              try {
                await this.processSelectionResult(result.selectionId, result.result);
                settlement.processedSelections++;
              } catch (error) {
                this.logger.error(`Error settling selection ${result.selectionId}:`, error);
                settlement.errors.push({
                  selectionId: result.selectionId,
                  error: error.message,
                });
              }
            }

            // Update market status
            await ctx.call("event.updateMarketStatus", {
              marketId,
              status: "settled",
            });

            settlement.status = settlement.errors.length > 0 ? "completed_with_errors" : "completed";
            settlement.completedAt = new Date();

            this.logger.info(
              `Market ${marketId} settled: ${settlement.processedSelections}/${results.length} selections, ` +
              `${settlement.errors.length} errors`
            );

            // Emit event
            this.broker.emit("settlement.marketSettled", {
              settlementId,
              marketId,
              status: settlement.status,
            });

            return settlement;
          },
        },

        /**
         * Settle an entire event
         */
        settleEvent: {
          params: {
            eventId: { type: "string" },
            homeScore: { type: "number", integer: true },
            awayScore: { type: "number", integer: true },
          },
          visibility: "protected",
          async handler(ctx) {
            const { eventId, homeScore, awayScore } = ctx.params;

            this.logger.info(`Settling event ${eventId}, score: ${homeScore}-${awayScore}`);

            // Get event with markets
            const event = await ctx.call("event.get", { id: eventId });
            if (!event) {
              throw new this.broker.MoleculerClientError("Event not found", 404, "EVENT_NOT_FOUND");
            }

            const settlementResults = [];

            // Process each market
            for (const market of event.markets || []) {
              const results = this.determineMarketResults(market, homeScore, awayScore, event);

              if (results.length > 0) {
                const marketSettlement = await ctx.call("settlement.settleMarket", {
                  marketId: market.id,
                  results,
                });
                settlementResults.push(marketSettlement);
              }
            }

            // Update event status
            await ctx.call("event.updateStatus", {
              eventId,
              status: "finished",
              homeScore,
              awayScore,
            });

            this.logger.info(`Event ${eventId} fully settled`);

            return {
              eventId,
              homeScore,
              awayScore,
              marketsSettled: settlementResults.length,
              settlements: settlementResults,
            };
          },
        },

        /**
         * Void a market (refund all bets)
         */
        voidMarket: {
          params: {
            marketId: { type: "string" },
            reason: { type: "string" },
          },
          visibility: "protected",
          async handler(ctx) {
            const { marketId, reason } = ctx.params;

            this.logger.info(`Voiding market ${marketId}: ${reason}`);

            // Get all open bets for this market's selections
            const bets = await this.getBetsForMarket(marketId);

            let refundedCount = 0;
            const errors = [];

            for (const bet of bets) {
              try {
                // Mark all selections from this market as void
                for (const selection of bet.selections) {
                  if (selection.marketId === marketId) {
                    selection.status = "void";
                    selection.settledAt = new Date();
                  }
                }

                // Check if entire bet should be voided or recalculated
                const pendingSelections = bet.selections.filter((s) => s.status === "pending");
                const voidedSelections = bet.selections.filter((s) => s.status === "void");

                if (voidedSelections.length === bet.selections.length) {
                  // All selections void = full refund
                  await ctx.call("bet.settle", {
                    betId: bet.id,
                    result: "void",
                  });
                  refundedCount++;
                } else if (pendingSelections.length === 0) {
                  // Recalculate with remaining selections
                  const activeSelections = bet.selections.filter(
                    (s) => s.status === "won" || s.status === "winner"
                  );
                  if (activeSelections.length > 0) {
                    const newOdds = activeSelections.reduce((acc, s) => acc * s.oddsAtPlacement, 1);
                    await ctx.call("bet.settle", {
                      betId: bet.id,
                      result: "won",
                      settledAmount: bet.stake * newOdds,
                    });
                  }
                }
              } catch (error) {
                errors.push({ betId: bet.id, error: error.message });
              }
            }

            // Update market status
            await ctx.call("event.updateMarketStatus", {
              marketId,
              status: "voided",
            });

            return {
              marketId,
              reason,
              betsProcessed: bets.length,
              refundedCount,
              errors,
            };
          },
        },

        /**
         * Get settlement status
         */
        getStatus: {
          rest: "GET /status/:id",
          params: {
            id: { type: "uuid" },
          },
          async handler(ctx) {
            const settlement = this.settlements.get(ctx.params.id);
            if (!settlement) {
              throw new this.broker.MoleculerClientError("Settlement not found", 404, "SETTLEMENT_NOT_FOUND");
            }
            return settlement;
          },
        },

        /**
         * Get pending settlements
         */
        getPending: {
          rest: "GET /pending",
          async handler(ctx) {
            return Array.from(this.pendingSettlements.values());
          },
        },

        /**
         * Retry failed settlement
         */
        retry: {
          params: {
            settlementId: { type: "uuid" },
          },
          visibility: "protected",
          async handler(ctx) {
            const settlement = this.settlements.get(ctx.params.settlementId);
            if (!settlement) {
              throw new this.broker.MoleculerClientError("Settlement not found", 404, "SETTLEMENT_NOT_FOUND");
            }

            if (settlement.errors.length === 0) {
              return { message: "No errors to retry" };
            }

            // Retry failed selections
            const retryResults = [];
            for (const error of settlement.errors) {
              try {
                const result = settlement.results.find((r) => r.selectionId === error.selectionId);
                if (result) {
                  await this.processSelectionResult(result.selectionId, result.result);
                  retryResults.push({ selectionId: result.selectionId, success: true });
                }
              } catch (err) {
                retryResults.push({ selectionId: error.selectionId, success: false, error: err.message });
              }
            }

            return { retryResults };
          },
        },

        /**
         * Ping for health checks
         */
        ping: {
          async handler() {
            return {
              status: "ok",
              service: "settlement",
              pendingSettlements: this.pendingSettlements.size,
              timestamp: Date.now(),
            };
          },
        },
      },

      events: {
        /**
         * Handle event finished
         */
        async "event.finished"(ctx) {
          const { eventId, homeScore, awayScore } = ctx.params;

          // Queue for settlement
          this.pendingSettlements.set(eventId, {
            eventId,
            homeScore,
            awayScore,
            queuedAt: new Date(),
          });

          this.logger.info(`Event ${eventId} queued for settlement`);
        },

        /**
         * Handle market status changed
         */
        "market.statusChanged"(ctx) {
          const { marketId, status } = ctx.params;
          if (status === "settled" || status === "voided") {
            this.logger.info(`Market ${marketId} marked as ${status}`);
          }
        },
      },

      methods: {
        /**
         * Process a selection result
         */
        async processSelectionResult(selectionId, result) {
          // Update selection status in event service
          await this.broker.call("event.settleSelection", {
            selectionId,
            result,
          });

          // The bet service listens for selection.settled events
          // and handles bet settlement automatically
        },

        /**
         * Determine market results based on score
         */
        determineMarketResults(market, homeScore, awayScore, event) {
          const results = [];

          switch (market.type) {
            case "1x2":
              results.push(...this.settle1X2Market(market, homeScore, awayScore, event));
              break;

            case "over_under":
              results.push(...this.settleOverUnderMarket(market, homeScore, awayScore));
              break;

            case "spread":
              results.push(...this.settleSpreadMarket(market, homeScore, awayScore, event));
              break;

            default:
              this.logger.warn(`Unknown market type: ${market.type}`);
          }

          return results;
        },

        /**
         * Settle 1X2 (Match Result) market
         */
        settle1X2Market(market, homeScore, awayScore, event) {
          const results = [];
          let winner;

          if (homeScore > awayScore) {
            winner = event.homeTeam;
          } else if (awayScore > homeScore) {
            winner = event.awayTeam;
          } else {
            winner = "Draw";
          }

          for (const selection of market.selections || []) {
            const isWinner = selection.name === winner ||
              (selection.name === "Draw" && homeScore === awayScore);

            results.push({
              selectionId: selection.id,
              result: isWinner ? "winner" : "loser",
            });
          }

          return results;
        },

        /**
         * Settle Over/Under market
         */
        settleOverUnderMarket(market, homeScore, awayScore) {
          const results = [];
          const totalGoals = homeScore + awayScore;
          const line = market.metadata?.line || 2.5;

          for (const selection of market.selections || []) {
            const isOver = selection.name.toLowerCase().includes("over");
            let result;

            if (totalGoals === line) {
              result = "push"; // Refund on exact line
            } else if (isOver) {
              result = totalGoals > line ? "winner" : "loser";
            } else {
              result = totalGoals < line ? "winner" : "loser";
            }

            results.push({
              selectionId: selection.id,
              result,
            });
          }

          return results;
        },

        /**
         * Settle Spread/Handicap market
         */
        settleSpreadMarket(market, homeScore, awayScore, event) {
          const results = [];

          for (const selection of market.selections || []) {
            const spread = selection.point || 0;
            const isHome = selection.name.includes(event.homeTeam);

            let adjustedDiff;
            if (isHome) {
              adjustedDiff = (homeScore + spread) - awayScore;
            } else {
              adjustedDiff = (awayScore + spread) - homeScore;
            }

            let result;
            if (adjustedDiff === 0) {
              result = "push";
            } else if (adjustedDiff > 0) {
              result = "winner";
            } else {
              result = "loser";
            }

            results.push({
              selectionId: selection.id,
              result,
            });
          }

          return results;
        },

        /**
         * Get all bets for a market
         */
        async getBetsForMarket(marketId) {
          // This would query bets that have selections from this market
          // For now, return empty array - bet service handles this via events
          return [];
        },

        /**
         * Process pending settlements
         */
        async processPendingSettlements() {
          for (const [eventId, pending] of this.pendingSettlements.entries()) {
            try {
              await this.broker.call("settlement.settleEvent", {
                eventId: pending.eventId,
                homeScore: pending.homeScore,
                awayScore: pending.awayScore,
              });
              this.pendingSettlements.delete(eventId);
            } catch (error) {
              this.logger.error(`Failed to settle event ${eventId}:`, error);
              pending.lastError = error.message;
              pending.retryCount = (pending.retryCount || 0) + 1;

              if (pending.retryCount >= this.settings.retryAttempts) {
                this.logger.error(`Max retries reached for event ${eventId}, removing from queue`);
                this.pendingSettlements.delete(eventId);
              }
            }
          }
        },

        /**
         * Start settlement processor
         */
        startProcessor() {
          this.processorTimer = setInterval(() => {
            this.processPendingSettlements();
          }, this.settings.processInterval);
        },

        /**
         * Stop settlement processor
         */
        stopProcessor() {
          if (this.processorTimer) {
            clearInterval(this.processorTimer);
            this.processorTimer = null;
          }
        },
      },

      created() {
        this.settlements = new Map();
        this.pendingSettlements = new Map();
        this.processorTimer = null;
      },

      async started() {
        this.logger.info("Settlement service started");
        this.startProcessor();
      },

      async stopped() {
        this.stopProcessor();
        this.logger.info("Settlement service stopped");
      },
    });
  }
};
