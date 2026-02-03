"use strict";

const { Service } = require("moleculer");
const { v4: uuidv4 } = require("uuid");

/**
 * Wallet Service
 * Handles balance management, transactions, and fund operations
 */
module.exports = class WalletService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: "wallet",

      settings: {
        defaultCurrency: "USD",
        minDeposit: parseFloat(process.env.WALLET_MIN_DEPOSIT) || 1,
        maxDeposit: parseFloat(process.env.WALLET_MAX_DEPOSIT) || 50000,
        minWithdrawal: parseFloat(process.env.WALLET_MIN_WITHDRAWAL) || 10,
        maxWithdrawal: parseFloat(process.env.WALLET_MAX_WITHDRAWAL) || 50000,
      },

      metadata: {
        description: "Wallet and transaction management",
        version: "1.0.0",
      },

      dependencies: [],

      actions: {
        /**
         * Create a new wallet for a user
         */
        create: {
          params: {
            userId: { type: "uuid" },
            currency: { type: "string", default: "USD", optional: true },
          },
          async handler(ctx) {
            const { userId, currency } = ctx.params;

            // Check if wallet already exists
            const existing = await this.getWalletByUserId(userId, currency || this.settings.defaultCurrency);
            if (existing) {
              throw new this.broker.MoleculerClientError("Wallet already exists", 409, "WALLET_EXISTS");
            }

            const wallet = {
              id: uuidv4(),
              userId,
              balance: 0,
              lockedBalance: 0,
              currency: currency || this.settings.defaultCurrency,
              status: "active",
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            await this.saveWallet(wallet);

            this.logger.info(`Wallet created for user ${userId}`);

            return wallet;
          },
        },

        /**
         * Get wallet by user ID
         */
        get: {
          params: {
            userId: { type: "uuid" },
          },
          async handler(ctx) {
            const wallet = await this.getWalletByUserId(ctx.params.userId);
            if (!wallet) {
              throw new this.broker.MoleculerClientError("Wallet not found", 404, "WALLET_NOT_FOUND");
            }
            return wallet;
          },
        },

        /**
         * Get wallet balance
         */
        balance: {
          rest: "GET /balance",
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (!userId) {
              throw new this.broker.MoleculerClientError("Authentication required", 401, "AUTH_REQUIRED");
            }

            const wallet = await this.getWalletByUserId(userId);
            if (!wallet) {
              throw new this.broker.MoleculerClientError("Wallet not found", 404, "WALLET_NOT_FOUND");
            }

            return {
              balance: wallet.balance,
              lockedBalance: wallet.lockedBalance,
              availableBalance: wallet.balance - wallet.lockedBalance,
              currency: wallet.currency,
            };
          },
        },

        /**
         * Deposit funds
         */
        deposit: {
          rest: "POST /deposit",
          params: {
            amount: { type: "number", positive: true },
            paymentMethod: { type: "string", enum: ["card", "bank", "crypto"] },
            paymentReference: { type: "string", optional: true },
          },
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (!userId) {
              throw new this.broker.MoleculerClientError("Authentication required", 401, "AUTH_REQUIRED");
            }

            const { amount, paymentMethod, paymentReference } = ctx.params;

            // Validate amount
            if (amount < this.settings.minDeposit) {
              throw new this.broker.MoleculerClientError(
                `Minimum deposit is ${this.settings.minDeposit}`,
                400,
                "MIN_DEPOSIT"
              );
            }
            if (amount > this.settings.maxDeposit) {
              throw new this.broker.MoleculerClientError(
                `Maximum deposit is ${this.settings.maxDeposit}`,
                400,
                "MAX_DEPOSIT"
              );
            }

            const wallet = await this.getWalletByUserId(userId);
            if (!wallet) {
              throw new this.broker.MoleculerClientError("Wallet not found", 404, "WALLET_NOT_FOUND");
            }

            if (wallet.status !== "active") {
              throw new this.broker.MoleculerClientError("Wallet is not active", 400, "WALLET_INACTIVE");
            }

            // Process deposit
            const transaction = await this.processTransaction(wallet, {
              type: "deposit",
              amount,
              metadata: {
                paymentMethod,
                paymentReference,
              },
            });

            this.logger.info(`Deposit of ${amount} processed for user ${userId}`);

            // Emit event
            this.broker.emit("wallet.deposit", {
              userId,
              amount,
              transactionId: transaction.id,
            });

            return {
              success: true,
              transaction,
              newBalance: wallet.balance,
            };
          },
        },

        /**
         * Withdraw funds
         */
        withdraw: {
          rest: "POST /withdraw",
          params: {
            amount: { type: "number", positive: true },
            withdrawalMethod: { type: "string", enum: ["card", "bank", "crypto"] },
            withdrawalDetails: { type: "object", optional: true },
          },
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (!userId) {
              throw new this.broker.MoleculerClientError("Authentication required", 401, "AUTH_REQUIRED");
            }

            const { amount, withdrawalMethod, withdrawalDetails } = ctx.params;

            // Validate amount
            if (amount < this.settings.minWithdrawal) {
              throw new this.broker.MoleculerClientError(
                `Minimum withdrawal is ${this.settings.minWithdrawal}`,
                400,
                "MIN_WITHDRAWAL"
              );
            }
            if (amount > this.settings.maxWithdrawal) {
              throw new this.broker.MoleculerClientError(
                `Maximum withdrawal is ${this.settings.maxWithdrawal}`,
                400,
                "MAX_WITHDRAWAL"
              );
            }

            const wallet = await this.getWalletByUserId(userId);
            if (!wallet) {
              throw new this.broker.MoleculerClientError("Wallet not found", 404, "WALLET_NOT_FOUND");
            }

            if (wallet.status !== "active") {
              throw new this.broker.MoleculerClientError("Wallet is not active", 400, "WALLET_INACTIVE");
            }

            const availableBalance = wallet.balance - wallet.lockedBalance;
            if (amount > availableBalance) {
              throw new this.broker.MoleculerClientError(
                `Insufficient funds. Available: ${availableBalance}`,
                400,
                "INSUFFICIENT_FUNDS"
              );
            }

            // Process withdrawal
            const transaction = await this.processTransaction(wallet, {
              type: "withdrawal",
              amount: -amount,
              metadata: {
                withdrawalMethod,
                withdrawalDetails,
              },
            });

            this.logger.info(`Withdrawal of ${amount} processed for user ${userId}`);

            // Emit event
            this.broker.emit("wallet.withdrawal", {
              userId,
              amount,
              transactionId: transaction.id,
            });

            return {
              success: true,
              transaction,
              newBalance: wallet.balance,
            };
          },
        },

        /**
         * Lock funds for a bet
         */
        lock: {
          params: {
            userId: { type: "uuid" },
            amount: { type: "number", positive: true },
            referenceId: { type: "uuid" },
            referenceType: { type: "string", default: "bet" },
          },
          visibility: "protected",
          async handler(ctx) {
            const { userId, amount, referenceId, referenceType } = ctx.params;

            const wallet = await this.getWalletByUserId(userId);
            if (!wallet) {
              throw new this.broker.MoleculerClientError("Wallet not found", 404, "WALLET_NOT_FOUND");
            }

            if (wallet.status !== "active") {
              throw new this.broker.MoleculerClientError("Wallet is not active", 400, "WALLET_INACTIVE");
            }

            const availableBalance = wallet.balance - wallet.lockedBalance;
            if (amount > availableBalance) {
              throw new this.broker.MoleculerClientError(
                `Insufficient funds. Available: ${availableBalance}`,
                400,
                "INSUFFICIENT_FUNDS"
              );
            }

            // Lock the funds
            wallet.lockedBalance += amount;
            wallet.updatedAt = new Date();
            await this.saveWallet(wallet);

            // Record the lock
            const lock = {
              id: uuidv4(),
              walletId: wallet.id,
              userId,
              amount,
              referenceId,
              referenceType,
              status: "active",
              createdAt: new Date(),
            };
            await this.saveLock(lock);

            this.logger.info(`Locked ${amount} for ${referenceType} ${referenceId}`);

            return {
              success: true,
              lockId: lock.id,
              lockedAmount: amount,
              availableBalance: wallet.balance - wallet.lockedBalance,
            };
          },
        },

        /**
         * Release locked funds (bet cancelled or rejected)
         */
        unlock: {
          params: {
            lockId: { type: "uuid" },
          },
          visibility: "protected",
          async handler(ctx) {
            const { lockId } = ctx.params;

            const lock = await this.getLockById(lockId);
            if (!lock) {
              throw new this.broker.MoleculerClientError("Lock not found", 404, "LOCK_NOT_FOUND");
            }

            if (lock.status !== "active") {
              throw new this.broker.MoleculerClientError("Lock is not active", 400, "LOCK_INACTIVE");
            }

            const wallet = await this.getWalletByUserId(lock.userId);
            if (!wallet) {
              throw new this.broker.MoleculerClientError("Wallet not found", 404, "WALLET_NOT_FOUND");
            }

            // Release the lock
            wallet.lockedBalance = Math.max(0, wallet.lockedBalance - lock.amount);
            wallet.updatedAt = new Date();
            await this.saveWallet(wallet);

            // Update lock status
            lock.status = "released";
            lock.releasedAt = new Date();
            await this.saveLock(lock);

            this.logger.info(`Released lock ${lockId} for ${lock.amount}`);

            return {
              success: true,
              releasedAmount: lock.amount,
              availableBalance: wallet.balance - wallet.lockedBalance,
            };
          },
        },

        /**
         * Debit funds (bet placed - convert lock to debit)
         */
        debit: {
          params: {
            userId: { type: "uuid" },
            amount: { type: "number", positive: true },
            lockId: { type: "uuid", optional: true },
            referenceId: { type: "uuid" },
            referenceType: { type: "string", default: "bet_stake" },
          },
          visibility: "protected",
          async handler(ctx) {
            const { userId, amount, lockId, referenceId, referenceType } = ctx.params;

            const wallet = await this.getWalletByUserId(userId);
            if (!wallet) {
              throw new this.broker.MoleculerClientError("Wallet not found", 404, "WALLET_NOT_FOUND");
            }

            // If there's a lock, release it first
            if (lockId) {
              const lock = await this.getLockById(lockId);
              if (lock && lock.status === "active") {
                wallet.lockedBalance = Math.max(0, wallet.lockedBalance - lock.amount);
                lock.status = "converted";
                lock.convertedAt = new Date();
                await this.saveLock(lock);
              }
            }

            // Check balance
            if (amount > wallet.balance) {
              throw new this.broker.MoleculerClientError("Insufficient funds", 400, "INSUFFICIENT_FUNDS");
            }

            // Process debit
            const transaction = await this.processTransaction(wallet, {
              type: referenceType,
              amount: -amount,
              referenceId,
              referenceType,
            });

            this.logger.info(`Debited ${amount} from user ${userId} for ${referenceType}`);

            return {
              success: true,
              transaction,
              newBalance: wallet.balance,
            };
          },
        },

        /**
         * Credit funds (bet win, refund)
         */
        credit: {
          params: {
            userId: { type: "uuid" },
            amount: { type: "number", positive: true },
            referenceId: { type: "uuid" },
            referenceType: { type: "string", enum: ["bet_win", "bet_refund", "bonus", "transfer_in"] },
          },
          visibility: "protected",
          async handler(ctx) {
            const { userId, amount, referenceId, referenceType } = ctx.params;

            const wallet = await this.getWalletByUserId(userId);
            if (!wallet) {
              throw new this.broker.MoleculerClientError("Wallet not found", 404, "WALLET_NOT_FOUND");
            }

            // Process credit
            const transaction = await this.processTransaction(wallet, {
              type: referenceType,
              amount,
              referenceId,
              referenceType,
            });

            this.logger.info(`Credited ${amount} to user ${userId} for ${referenceType}`);

            // Emit event
            this.broker.emit("wallet.credit", {
              userId,
              amount,
              referenceType,
              transactionId: transaction.id,
            });

            return {
              success: true,
              transaction,
              newBalance: wallet.balance,
            };
          },
        },

        /**
         * Get transaction history
         */
        transactions: {
          rest: "GET /transactions",
          params: {
            page: { type: "number", integer: true, min: 1, default: 1, optional: true },
            limit: { type: "number", integer: true, min: 1, max: 100, default: 20, optional: true },
            type: { type: "string", optional: true },
          },
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (!userId) {
              throw new this.broker.MoleculerClientError("Authentication required", 401, "AUTH_REQUIRED");
            }

            const { page, limit, type } = ctx.params;

            const wallet = await this.getWalletByUserId(userId);
            if (!wallet) {
              throw new this.broker.MoleculerClientError("Wallet not found", 404, "WALLET_NOT_FOUND");
            }

            const transactions = await this.getTransactions(wallet.id, { page, limit, type });

            return transactions;
          },
        },

        /**
         * Ping for health checks
         */
        ping: {
          async handler() {
            return { status: "ok", service: "wallet", timestamp: Date.now() };
          },
        },
      },

      methods: {
        /**
         * Process a transaction and update wallet balance
         */
        async processTransaction(wallet, { type, amount, referenceId, referenceType, metadata }) {
          const balanceBefore = wallet.balance;
          const balanceAfter = balanceBefore + amount;

          if (balanceAfter < 0) {
            throw new this.broker.MoleculerClientError("Insufficient funds", 400, "INSUFFICIENT_FUNDS");
          }

          const transaction = {
            id: uuidv4(),
            walletId: wallet.id,
            type,
            amount,
            balanceBefore,
            balanceAfter,
            referenceType: referenceType || null,
            referenceId: referenceId || null,
            status: "completed",
            metadata: metadata || {},
            createdAt: new Date(),
          };

          // Update wallet balance
          wallet.balance = balanceAfter;
          wallet.updatedAt = new Date();

          await this.saveWallet(wallet);
          await this.saveTransaction(transaction);

          return transaction;
        },

        // In-memory storage (replace with database in production)
        async getWalletByUserId(userId, currency = "USD") {
          const key = `${userId}:${currency}`;
          return this.wallets.get(key);
        },

        async saveWallet(wallet) {
          const key = `${wallet.userId}:${wallet.currency}`;
          this.wallets.set(key, wallet);
        },

        async getLockById(lockId) {
          return this.locks.get(lockId);
        },

        async saveLock(lock) {
          this.locks.set(lock.id, lock);
        },

        async saveTransaction(transaction) {
          const walletTransactions = this.transactions.get(transaction.walletId) || [];
          walletTransactions.unshift(transaction);
          this.transactions.set(transaction.walletId, walletTransactions);
        },

        async getTransactions(walletId, { page = 1, limit = 20, type }) {
          let transactions = this.transactions.get(walletId) || [];

          if (type) {
            transactions = transactions.filter((t) => t.type === type);
          }

          const total = transactions.length;
          const start = (page - 1) * limit;
          const items = transactions.slice(start, start + limit);

          return {
            items,
            pagination: {
              page,
              limit,
              total,
              totalPages: Math.ceil(total / limit),
            },
          };
        },
      },

      created() {
        // In-memory stores (replace with Redis/DB in production)
        this.wallets = new Map();
        this.transactions = new Map();
        this.locks = new Map();
      },

      async started() {
        this.logger.info("Wallet service started");
      },

      async stopped() {
        this.logger.info("Wallet service stopped");
      },
    });
  }
};
