"use strict";

const { Service } = require("moleculer");
const { v4: uuidv4 } = require("uuid");

/**
 * Bet Service
 * Handles bet placement, validation, and management
 */
module.exports = class BetService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: "bet",

      settings: {
        minStake: parseFloat(process.env.BET_MIN_STAKE) || 0.01,
        maxStake: parseFloat(process.env.BET_MAX_STAKE) || 100000,
        maxSelections: parseInt(process.env.BET_MAX_SELECTIONS, 10) || 20,
        oddsTolerance: 0.05, // 5% tolerance for odds changes
        maxPotentialWin: parseFloat(process.env.BET_MAX_POTENTIAL_WIN) || 500000,
      },

      metadata: {
        description: "Bet placement and management",
        version: "1.0.0",
      },

      dependencies: ["wallet", "odds"],

      actions: {
        /**
         * Place a single bet
         */
        place: {
          rest: "POST /place",
          params: {
            eventId: { type: "string" },
            marketId: { type: "string" },
            selectionId: { type: "string" },
            odds: { type: "number", positive: true },
            stake: { type: "number", positive: true },
          },
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (!userId) {
              throw new this.broker.MoleculerClientError("Authentication required", 401, "AUTH_REQUIRED");
            }

            const { eventId, marketId, selectionId, odds, stake } = ctx.params;

            // Validate stake
            this.validateStake(stake);

            // Validate odds haven't changed
            const oddsValidation = await ctx.call("odds.validate", {
              selectionId,
              expectedOdds: odds,
              tolerance: this.settings.oddsTolerance,
            });

            if (!oddsValidation.valid) {
              throw new this.broker.MoleculerClientError(
                oddsValidation.reason,
                409,
                "ODDS_CHANGED",
                { expectedOdds: odds, currentOdds: oddsValidation.currentOdds }
              );
            }

            const currentOdds = oddsValidation.currentOdds;
            const potentialWin = stake * currentOdds;

            // Validate potential win
            if (potentialWin > this.settings.maxPotentialWin) {
              throw new this.broker.MoleculerClientError(
                `Potential win exceeds maximum of ${this.settings.maxPotentialWin}`,
                400,
                "MAX_POTENTIAL_WIN_EXCEEDED"
              );
            }

            // Lock funds in wallet
            let lockResult;
            try {
              lockResult = await ctx.call("wallet.lock", {
                userId,
                amount: stake,
                referenceId: uuidv4(), // Temporary, will be replaced with bet ID
                referenceType: "bet",
              });
            } catch (error) {
              throw new this.broker.MoleculerClientError(
                error.message || "Insufficient funds",
                400,
                "INSUFFICIENT_FUNDS"
              );
            }

            // Create bet
            const bet = {
              id: uuidv4(),
              userId,
              betType: "single",
              stake,
              potentialWin,
              totalOdds: currentOdds,
              status: "open",
              settledAmount: null,
              cashoutAmount: null,
              placedAt: new Date(),
              settledAt: null,
              ipAddress: ctx.meta.ip,
              userAgent: ctx.meta.userAgent,
              lockId: lockResult.lockId,
              selections: [
                {
                  id: uuidv4(),
                  eventId,
                  marketId,
                  selectionId,
                  oddsAtPlacement: currentOdds,
                  status: "pending",
                },
              ],
            };

            // Debit funds from wallet
            try {
              await ctx.call("wallet.debit", {
                userId,
                amount: stake,
                lockId: lockResult.lockId,
                referenceId: bet.id,
                referenceType: "bet_stake",
              });
            } catch (error) {
              // Release lock if debit fails
              await ctx.call("wallet.unlock", { lockId: lockResult.lockId });
              throw error;
            }

            // Save bet
            await this.saveBet(bet);

            this.logger.info(`Bet placed: ${bet.id} by user ${userId}, stake: ${stake}, odds: ${currentOdds}`);

            // Emit event
            this.broker.emit("bet.placed", {
              betId: bet.id,
              userId,
              stake,
              potentialWin,
              selectionId,
            });

            return {
              betId: bet.id,
              status: bet.status,
              stake: bet.stake,
              odds: bet.totalOdds,
              potentialWin: bet.potentialWin,
              placedAt: bet.placedAt,
            };
          },
        },

        /**
         * Place an accumulator bet
         */
        placeAccumulator: {
          rest: "POST /place/accumulator",
          params: {
            selections: {
              type: "array",
              min: 2,
              items: {
                type: "object",
                props: {
                  eventId: { type: "string" },
                  marketId: { type: "string" },
                  selectionId: { type: "string" },
                  odds: { type: "number", positive: true },
                },
              },
            },
            stake: { type: "number", positive: true },
          },
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (!userId) {
              throw new this.broker.MoleculerClientError("Authentication required", 401, "AUTH_REQUIRED");
            }

            const { selections, stake } = ctx.params;

            // Validate number of selections
            if (selections.length > this.settings.maxSelections) {
              throw new this.broker.MoleculerClientError(
                `Maximum ${this.settings.maxSelections} selections allowed`,
                400,
                "MAX_SELECTIONS_EXCEEDED"
              );
            }

            // Check for duplicate events
            const eventIds = selections.map((s) => s.eventId);
            if (new Set(eventIds).size !== eventIds.length) {
              throw new this.broker.MoleculerClientError(
                "Cannot have multiple selections from the same event",
                400,
                "DUPLICATE_EVENT"
              );
            }

            // Validate stake
            this.validateStake(stake);

            // Validate all odds and calculate combined odds
            const validatedSelections = [];
            let combinedOdds = 1;

            for (const selection of selections) {
              const oddsValidation = await ctx.call("odds.validate", {
                selectionId: selection.selectionId,
                expectedOdds: selection.odds,
                tolerance: this.settings.oddsTolerance,
              });

              if (!oddsValidation.valid) {
                throw new this.broker.MoleculerClientError(
                  `Odds changed for selection ${selection.selectionId}: ${oddsValidation.reason}`,
                  409,
                  "ODDS_CHANGED",
                  { selectionId: selection.selectionId, ...oddsValidation }
                );
              }

              combinedOdds *= oddsValidation.currentOdds;
              validatedSelections.push({
                ...selection,
                currentOdds: oddsValidation.currentOdds,
              });
            }

            combinedOdds = Math.round(combinedOdds * 100) / 100;
            const potentialWin = Math.round(stake * combinedOdds * 100) / 100;

            // Validate potential win
            if (potentialWin > this.settings.maxPotentialWin) {
              throw new this.broker.MoleculerClientError(
                `Potential win exceeds maximum of ${this.settings.maxPotentialWin}`,
                400,
                "MAX_POTENTIAL_WIN_EXCEEDED"
              );
            }

            // Lock funds
            let lockResult;
            try {
              lockResult = await ctx.call("wallet.lock", {
                userId,
                amount: stake,
                referenceId: uuidv4(),
                referenceType: "bet",
              });
            } catch (error) {
              throw new this.broker.MoleculerClientError(
                error.message || "Insufficient funds",
                400,
                "INSUFFICIENT_FUNDS"
              );
            }

            // Create bet
            const bet = {
              id: uuidv4(),
              userId,
              betType: "accumulator",
              stake,
              potentialWin,
              totalOdds: combinedOdds,
              status: "open",
              settledAmount: null,
              cashoutAmount: null,
              placedAt: new Date(),
              settledAt: null,
              ipAddress: ctx.meta.ip,
              userAgent: ctx.meta.userAgent,
              lockId: lockResult.lockId,
              selections: validatedSelections.map((s) => ({
                id: uuidv4(),
                eventId: s.eventId,
                marketId: s.marketId,
                selectionId: s.selectionId,
                oddsAtPlacement: s.currentOdds,
                status: "pending",
              })),
            };

            // Debit funds
            try {
              await ctx.call("wallet.debit", {
                userId,
                amount: stake,
                lockId: lockResult.lockId,
                referenceId: bet.id,
                referenceType: "bet_stake",
              });
            } catch (error) {
              await ctx.call("wallet.unlock", { lockId: lockResult.lockId });
              throw error;
            }

            // Save bet
            await this.saveBet(bet);

            this.logger.info(
              `Accumulator bet placed: ${bet.id} by user ${userId}, ` +
              `stake: ${stake}, selections: ${selections.length}, odds: ${combinedOdds}`
            );

            // Emit event
            this.broker.emit("bet.placed", {
              betId: bet.id,
              userId,
              stake,
              potentialWin,
              betType: "accumulator",
              selectionCount: selections.length,
            });

            return {
              betId: bet.id,
              status: bet.status,
              betType: bet.betType,
              stake: bet.stake,
              totalOdds: bet.totalOdds,
              potentialWin: bet.potentialWin,
              selections: bet.selections.length,
              placedAt: bet.placedAt,
            };
          },
        },

        /**
         * Get bet by ID
         */
        get: {
          rest: "GET /:id",
          params: {
            id: { type: "uuid" },
          },
          async handler(ctx) {
            const userId = ctx.meta.userId;
            const bet = await this.getBetById(ctx.params.id);

            if (!bet) {
              throw new this.broker.MoleculerClientError("Bet not found", 404, "BET_NOT_FOUND");
            }

            // Users can only view their own bets
            if (userId && bet.userId !== userId) {
              throw new this.broker.MoleculerClientError("Access denied", 403, "ACCESS_DENIED");
            }

            return bet;
          },
        },

        /**
         * Get user's bet history
         */
        history: {
          rest: "GET /history",
          params: {
            page: { type: "number", integer: true, min: 1, default: 1, optional: true },
            limit: { type: "number", integer: true, min: 1, max: 100, default: 20, optional: true },
            status: { type: "string", optional: true },
          },
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (!userId) {
              throw new this.broker.MoleculerClientError("Authentication required", 401, "AUTH_REQUIRED");
            }

            const { page, limit, status } = ctx.params;
            return this.getUserBets(userId, { page, limit, status });
          },
        },

        /**
         * Get user's open bets
         */
        openBets: {
          rest: "GET /open",
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (!userId) {
              throw new this.broker.MoleculerClientError("Authentication required", 401, "AUTH_REQUIRED");
            }

            return this.getUserOpenBets(userId);
          },
        },

        /**
         * Cash out a bet
         */
        cashout: {
          rest: "POST /:id/cashout",
          params: {
            id: { type: "uuid" },
          },
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (!userId) {
              throw new this.broker.MoleculerClientError("Authentication required", 401, "AUTH_REQUIRED");
            }

            const bet = await this.getBetById(ctx.params.id);

            if (!bet) {
              throw new this.broker.MoleculerClientError("Bet not found", 404, "BET_NOT_FOUND");
            }

            if (bet.userId !== userId) {
              throw new this.broker.MoleculerClientError("Access denied", 403, "ACCESS_DENIED");
            }

            if (bet.status !== "open") {
              throw new this.broker.MoleculerClientError(
                "Bet is not eligible for cashout",
                400,
                "CASHOUT_NOT_AVAILABLE"
              );
            }

            // Calculate cashout value (simplified - in reality this would be more complex)
            const cashoutValue = this.calculateCashoutValue(bet);

            if (!cashoutValue || cashoutValue <= 0) {
              throw new this.broker.MoleculerClientError(
                "Cashout not available for this bet",
                400,
                "CASHOUT_NOT_AVAILABLE"
              );
            }

            // Credit cashout amount to wallet
            await ctx.call("wallet.credit", {
              userId,
              amount: cashoutValue,
              referenceId: bet.id,
              referenceType: "bet_win", // Treated as a partial win
            });

            // Update bet status
            bet.status = "cashed_out";
            bet.cashoutAmount = cashoutValue;
            bet.settledAt = new Date();
            await this.saveBet(bet);

            this.logger.info(`Bet ${bet.id} cashed out for ${cashoutValue}`);

            // Emit event
            this.broker.emit("bet.cashedOut", {
              betId: bet.id,
              userId,
              cashoutAmount: cashoutValue,
            });

            return {
              betId: bet.id,
              status: bet.status,
              cashoutAmount: cashoutValue,
            };
          },
        },

        /**
         * Get cashout value for a bet
         */
        getCashoutValue: {
          rest: "GET /:id/cashout-value",
          params: {
            id: { type: "uuid" },
          },
          async handler(ctx) {
            const userId = ctx.meta.userId;
            const bet = await this.getBetById(ctx.params.id);

            if (!bet) {
              throw new this.broker.MoleculerClientError("Bet not found", 404, "BET_NOT_FOUND");
            }

            if (userId && bet.userId !== userId) {
              throw new this.broker.MoleculerClientError("Access denied", 403, "ACCESS_DENIED");
            }

            if (bet.status !== "open") {
              return { available: false, reason: "Bet is not open" };
            }

            const cashoutValue = this.calculateCashoutValue(bet);

            return {
              available: cashoutValue > 0,
              value: cashoutValue,
              originalStake: bet.stake,
              potentialWin: bet.potentialWin,
            };
          },
        },

        /**
         * Settle a bet (called by settlement-service)
         */
        settle: {
          params: {
            betId: { type: "uuid" },
            result: { type: "string", enum: ["won", "lost", "void", "partial"] },
            settledAmount: { type: "number", optional: true },
          },
          visibility: "protected",
          async handler(ctx) {
            const { betId, result, settledAmount } = ctx.params;

            const bet = await this.getBetById(betId);
            if (!bet) {
              throw new this.broker.MoleculerClientError("Bet not found", 404, "BET_NOT_FOUND");
            }

            if (bet.status !== "open") {
              throw new this.broker.MoleculerClientError("Bet already settled", 400, "BET_ALREADY_SETTLED");
            }

            bet.status = result === "won" ? "won" : result === "lost" ? "lost" : "void";
            bet.settledAt = new Date();

            if (result === "won") {
              bet.settledAmount = settledAmount || bet.potentialWin;

              // Credit winnings
              await ctx.call("wallet.credit", {
                userId: bet.userId,
                amount: bet.settledAmount,
                referenceId: bet.id,
                referenceType: "bet_win",
              });
            } else if (result === "void") {
              bet.settledAmount = bet.stake;

              // Refund stake
              await ctx.call("wallet.credit", {
                userId: bet.userId,
                amount: bet.stake,
                referenceId: bet.id,
                referenceType: "bet_refund",
              });
            } else {
              bet.settledAmount = 0;
            }

            await this.saveBet(bet);

            this.logger.info(`Bet ${betId} settled: ${result}, amount: ${bet.settledAmount}`);

            // Emit event
            this.broker.emit("bet.settled", {
              betId: bet.id,
              userId: bet.userId,
              result,
              settledAmount: bet.settledAmount,
            });

            return bet;
          },
        },

        /**
         * Get bets by selection (for settlement)
         */
        getBySelection: {
          params: {
            selectionId: { type: "string" },
            status: { type: "string", default: "open" },
          },
          visibility: "protected",
          async handler(ctx) {
            const { selectionId, status } = ctx.params;
            return this.getBetsBySelection(selectionId, status);
          },
        },

        /**
         * Ping for health checks
         */
        ping: {
          async handler() {
            return { status: "ok", service: "bet", timestamp: Date.now() };
          },
        },
      },

      events: {
        /**
         * Handle selection settled event
         */
        "selection.settled"(ctx) {
          const { selectionId, result } = ctx.params;
          this.handleSelectionSettled(selectionId, result);
        },
      },

      methods: {
        /**
         * Validate stake amount
         */
        validateStake(stake) {
          if (stake < this.settings.minStake) {
            throw new this.broker.MoleculerClientError(
              `Minimum stake is ${this.settings.minStake}`,
              400,
              "MIN_STAKE"
            );
          }
          if (stake > this.settings.maxStake) {
            throw new this.broker.MoleculerClientError(
              `Maximum stake is ${this.settings.maxStake}`,
              400,
              "MAX_STAKE"
            );
          }
        },

        /**
         * Calculate cashout value
         */
        calculateCashoutValue(bet) {
          // Simplified cashout calculation
          // In reality, this would consider:
          // - Current odds vs placement odds
          // - Number of selections settled
          // - Market liquidity
          // - Margin/vig

          if (bet.status !== "open") return 0;

          const settledWinners = bet.selections.filter((s) => s.status === "won").length;
          const pending = bet.selections.filter((s) => s.status === "pending").length;
          const lost = bet.selections.filter((s) => s.status === "lost").length;

          // If any selection lost, no cashout
          if (lost > 0) return 0;

          // If no pending selections, bet should be settled
          if (pending === 0) return 0;

          // Calculate partial cashout value
          // Winners increase value, pending reduce it (due to uncertainty)
          const winnerOdds = bet.selections
            .filter((s) => s.status === "won")
            .reduce((acc, s) => acc * s.oddsAtPlacement, 1);

          const progressValue = bet.stake * winnerOdds;

          // Apply margin (house takes ~10%)
          const cashoutValue = progressValue * 0.9;

          return Math.round(cashoutValue * 100) / 100;
        },

        /**
         * Handle selection settled
         */
        async handleSelectionSettled(selectionId, result) {
          const bets = await this.getBetsBySelection(selectionId, "open");

          for (const bet of bets) {
            // Update selection status in bet
            const selection = bet.selections.find((s) => s.selectionId === selectionId);
            if (selection) {
              selection.status = result;
              selection.settledAt = new Date();
            }

            // Check if bet should be settled
            const pending = bet.selections.filter((s) => s.status === "pending").length;
            const lost = bet.selections.filter((s) => s.status === "lost" || s.status === "loser").length;
            const voided = bet.selections.filter((s) => s.status === "void").length;

            if (lost > 0) {
              // Any loser = bet lost
              await this.broker.call("bet.settle", {
                betId: bet.id,
                result: "lost",
              });
            } else if (pending === 0) {
              // All selections settled and no losers = bet won
              // Recalculate odds excluding voided selections
              const activeSelections = bet.selections.filter((s) => s.status !== "void");
              const finalOdds = activeSelections.reduce((acc, s) => acc * s.oddsAtPlacement, 1);
              const settledAmount = bet.stake * finalOdds;

              await this.broker.call("bet.settle", {
                betId: bet.id,
                result: voided > 0 && activeSelections.length === 0 ? "void" : "won",
                settledAmount,
              });
            }

            await this.saveBet(bet);
          }
        },

        // Data access methods (in-memory, replace with DB)
        async getBetById(id) {
          return this.bets.get(id);
        },

        async saveBet(bet) {
          this.bets.set(bet.id, bet);

          // Index by user
          const userBets = this.userBetsIndex.get(bet.userId) || [];
          if (!userBets.includes(bet.id)) {
            userBets.push(bet.id);
            this.userBetsIndex.set(bet.userId, userBets);
          }

          // Index by selection
          for (const selection of bet.selections) {
            const selectionBets = this.selectionBetsIndex.get(selection.selectionId) || [];
            if (!selectionBets.includes(bet.id)) {
              selectionBets.push(bet.id);
              this.selectionBetsIndex.set(selection.selectionId, selectionBets);
            }
          }
        },

        async getUserBets(userId, { page = 1, limit = 20, status }) {
          const betIds = this.userBetsIndex.get(userId) || [];
          let bets = betIds.map((id) => this.bets.get(id)).filter(Boolean);

          if (status) {
            bets = bets.filter((b) => b.status === status);
          }

          // Sort by placed date descending
          bets.sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));

          const total = bets.length;
          const start = (page - 1) * limit;
          const items = bets.slice(start, start + limit);

          return {
            items,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
          };
        },

        async getUserOpenBets(userId) {
          const betIds = this.userBetsIndex.get(userId) || [];
          return betIds
            .map((id) => this.bets.get(id))
            .filter((b) => b && b.status === "open")
            .sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));
        },

        async getBetsBySelection(selectionId, status = "open") {
          const betIds = this.selectionBetsIndex.get(selectionId) || [];
          return betIds
            .map((id) => this.bets.get(id))
            .filter((b) => b && b.status === status);
        },
      },

      created() {
        this.bets = new Map();
        this.userBetsIndex = new Map();
        this.selectionBetsIndex = new Map();
      },

      async started() {
        this.logger.info("Bet service started");
      },

      async stopped() {
        this.logger.info("Bet service stopped");
      },
    });
  }
};
