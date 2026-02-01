"use strict";

const { Service } = require("moleculer");
const { v4: uuidv4 } = require("uuid");

/**
 * Notification Service
 * Handles push notifications, emails, and real-time alerts
 */
module.exports = class NotificationService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: "notification",

      settings: {
        // Notification channels
        channels: {
          push: true,
          email: true,
          sms: false,
          websocket: true,
        },

        // Batch settings
        batchSize: 100,
        batchInterval: 1000,

        // Retention
        retentionDays: 30,
      },

      metadata: {
        description: "Push notifications, emails, and real-time alerts",
        version: "1.0.0",
      },

      dependencies: [],

      actions: {
        /**
         * Send notification to a user
         */
        send: {
          params: {
            userId: { type: "uuid" },
            type: { type: "string" },
            title: { type: "string" },
            message: { type: "string" },
            data: { type: "object", optional: true },
            channels: { type: "array", items: "string", optional: true },
          },
          async handler(ctx) {
            const { userId, type, title, message, data, channels } = ctx.params;

            const notification = {
              id: uuidv4(),
              userId,
              type,
              title,
              message,
              data: data || {},
              channels: channels || ["push", "websocket"],
              status: "pending",
              createdAt: new Date(),
              sentAt: null,
              readAt: null,
            };

            await this.saveNotification(notification);

            // Send through each channel
            const results = await this.sendThroughChannels(notification);

            notification.status = results.every((r) => r.success) ? "sent" : "partial";
            notification.sentAt = new Date();
            await this.saveNotification(notification);

            return {
              notificationId: notification.id,
              status: notification.status,
              channels: results,
            };
          },
        },

        /**
         * Send notification to multiple users
         */
        sendBulk: {
          params: {
            userIds: { type: "array", items: "uuid" },
            type: { type: "string" },
            title: { type: "string" },
            message: { type: "string" },
            data: { type: "object", optional: true },
          },
          async handler(ctx) {
            const { userIds, type, title, message, data } = ctx.params;

            const results = [];
            for (const userId of userIds) {
              try {
                const result = await ctx.call("notification.send", {
                  userId,
                  type,
                  title,
                  message,
                  data,
                });
                results.push({ userId, success: true, ...result });
              } catch (error) {
                results.push({ userId, success: false, error: error.message });
              }
            }

            return {
              total: userIds.length,
              sent: results.filter((r) => r.success).length,
              failed: results.filter((r) => !r.success).length,
              results,
            };
          },
        },

        /**
         * Get user notifications
         */
        list: {
          rest: "GET /",
          params: {
            page: { type: "number", integer: true, min: 1, default: 1, optional: true },
            limit: { type: "number", integer: true, min: 1, max: 100, default: 20, optional: true },
            unreadOnly: { type: "boolean", default: false, optional: true },
          },
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (!userId) {
              throw new this.broker.MoleculerClientError("Authentication required", 401, "AUTH_REQUIRED");
            }

            const { page, limit, unreadOnly } = ctx.params;
            return this.getUserNotifications(userId, { page, limit, unreadOnly });
          },
        },

        /**
         * Get unread count
         */
        unreadCount: {
          rest: "GET /unread/count",
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (!userId) {
              throw new this.broker.MoleculerClientError("Authentication required", 401, "AUTH_REQUIRED");
            }

            return { count: this.getUnreadCount(userId) };
          },
        },

        /**
         * Mark notification as read
         */
        markAsRead: {
          rest: "POST /:id/read",
          params: {
            id: { type: "uuid" },
          },
          async handler(ctx) {
            const userId = ctx.meta.userId;
            const notification = this.notifications.get(ctx.params.id);

            if (!notification) {
              throw new this.broker.MoleculerClientError("Notification not found", 404, "NOT_FOUND");
            }

            if (notification.userId !== userId) {
              throw new this.broker.MoleculerClientError("Access denied", 403, "ACCESS_DENIED");
            }

            notification.readAt = new Date();
            await this.saveNotification(notification);

            return { success: true };
          },
        },

        /**
         * Mark all notifications as read
         */
        markAllAsRead: {
          rest: "POST /read-all",
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (!userId) {
              throw new this.broker.MoleculerClientError("Authentication required", 401, "AUTH_REQUIRED");
            }

            const userNotifications = this.userNotificationsIndex.get(userId) || [];
            let count = 0;

            for (const notifId of userNotifications) {
              const notification = this.notifications.get(notifId);
              if (notification && !notification.readAt) {
                notification.readAt = new Date();
                count++;
              }
            }

            return { markedAsRead: count };
          },
        },

        /**
         * Delete notification
         */
        delete: {
          rest: "DELETE /:id",
          params: {
            id: { type: "uuid" },
          },
          async handler(ctx) {
            const userId = ctx.meta.userId;
            const notification = this.notifications.get(ctx.params.id);

            if (!notification) {
              throw new this.broker.MoleculerClientError("Notification not found", 404, "NOT_FOUND");
            }

            if (notification.userId !== userId) {
              throw new this.broker.MoleculerClientError("Access denied", 403, "ACCESS_DENIED");
            }

            this.notifications.delete(ctx.params.id);

            // Update user index
            const userNotifications = this.userNotificationsIndex.get(userId) || [];
            const index = userNotifications.indexOf(ctx.params.id);
            if (index > -1) {
              userNotifications.splice(index, 1);
            }

            return { success: true };
          },
        },

        /**
         * Subscribe to push notifications
         */
        subscribe: {
          rest: "POST /subscribe",
          params: {
            token: { type: "string" },
            platform: { type: "string", enum: ["web", "ios", "android"] },
          },
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (!userId) {
              throw new this.broker.MoleculerClientError("Authentication required", 401, "AUTH_REQUIRED");
            }

            const { token, platform } = ctx.params;

            const subscription = {
              id: uuidv4(),
              userId,
              token,
              platform,
              createdAt: new Date(),
              active: true,
            };

            this.pushSubscriptions.set(subscription.id, subscription);

            // Index by user
            const userSubs = this.userSubscriptionsIndex.get(userId) || [];
            userSubs.push(subscription.id);
            this.userSubscriptionsIndex.set(userId, userSubs);

            return { subscriptionId: subscription.id };
          },
        },

        /**
         * Unsubscribe from push notifications
         */
        unsubscribe: {
          rest: "DELETE /subscribe/:id",
          params: {
            id: { type: "uuid" },
          },
          async handler(ctx) {
            const userId = ctx.meta.userId;
            const subscription = this.pushSubscriptions.get(ctx.params.id);

            if (!subscription || subscription.userId !== userId) {
              throw new this.broker.MoleculerClientError("Subscription not found", 404, "NOT_FOUND");
            }

            subscription.active = false;
            return { success: true };
          },
        },

        /**
         * Ping for health checks
         */
        ping: {
          async handler() {
            return {
              status: "ok",
              service: "notification",
              pendingNotifications: this.pendingQueue.length,
              timestamp: Date.now(),
            };
          },
        },
      },

      events: {
        /**
         * Handle bet placed
         */
        "bet.placed"(ctx) {
          const { betId, userId, stake, potentialWin } = ctx.params;
          this.queueNotification({
            userId,
            type: "bet_placed",
            title: "Bet Placed",
            message: `Your bet of $${stake.toFixed(2)} has been placed. Potential win: $${potentialWin.toFixed(2)}`,
            data: { betId, stake, potentialWin },
          });
        },

        /**
         * Handle bet settled
         */
        "bet.settled"(ctx) {
          const { betId, userId, result, settledAmount } = ctx.params;

          let title, message;
          if (result === "won") {
            title = "Congratulations! You Won!";
            message = `Your bet has won! $${settledAmount.toFixed(2)} has been added to your balance.`;
          } else if (result === "lost") {
            title = "Bet Lost";
            message = "Unfortunately, your bet did not win. Better luck next time!";
          } else {
            title = "Bet Voided";
            message = `Your bet has been voided. $${settledAmount.toFixed(2)} has been refunded.`;
          }

          this.queueNotification({
            userId,
            type: "bet_settled",
            title,
            message,
            data: { betId, result, settledAmount },
          });
        },

        /**
         * Handle bet cashed out
         */
        "bet.cashedOut"(ctx) {
          const { betId, userId, cashoutAmount } = ctx.params;
          this.queueNotification({
            userId,
            type: "bet_cashout",
            title: "Cash Out Successful",
            message: `You cashed out $${cashoutAmount.toFixed(2)} from your bet.`,
            data: { betId, cashoutAmount },
          });
        },

        /**
         * Handle wallet deposit
         */
        "wallet.deposit"(ctx) {
          const { userId, amount, transactionId } = ctx.params;
          this.queueNotification({
            userId,
            type: "deposit",
            title: "Deposit Successful",
            message: `$${amount.toFixed(2)} has been added to your wallet.`,
            data: { amount, transactionId },
          });
        },

        /**
         * Handle wallet withdrawal
         */
        "wallet.withdrawal"(ctx) {
          const { userId, amount, transactionId } = ctx.params;
          this.queueNotification({
            userId,
            type: "withdrawal",
            title: "Withdrawal Initiated",
            message: `Your withdrawal of $${amount.toFixed(2)} is being processed.`,
            data: { amount, transactionId },
          });
        },

        /**
         * Handle odds updates for subscribed events
         */
        "odds.updated"(ctx) {
          // Only notify for significant odds movements
          const { selectionId, odds, previousOdds, movement } = ctx.params;
          const changePercent = Math.abs((odds - previousOdds) / previousOdds) * 100;

          if (changePercent >= 10) {
            // Notify users who have bets on this selection
            // This would require tracking user subscriptions to events
            this.logger.info(`Significant odds change on ${selectionId}: ${changePercent.toFixed(1)}%`);
          }
        },
      },

      methods: {
        /**
         * Queue notification for batch processing
         */
        queueNotification(notification) {
          this.pendingQueue.push(notification);
        },

        /**
         * Process pending notification queue
         */
        async processQueue() {
          if (this.pendingQueue.length === 0) return;

          const batch = this.pendingQueue.splice(0, this.settings.batchSize);

          for (const notif of batch) {
            try {
              await this.broker.call("notification.send", notif);
            } catch (error) {
              this.logger.error("Failed to send notification:", error);
            }
          }
        },

        /**
         * Send notification through configured channels
         */
        async sendThroughChannels(notification) {
          const results = [];

          for (const channel of notification.channels) {
            try {
              switch (channel) {
                case "push":
                  await this.sendPushNotification(notification);
                  results.push({ channel: "push", success: true });
                  break;

                case "email":
                  await this.sendEmailNotification(notification);
                  results.push({ channel: "email", success: true });
                  break;

                case "websocket":
                  await this.sendWebSocketNotification(notification);
                  results.push({ channel: "websocket", success: true });
                  break;

                case "sms":
                  await this.sendSmsNotification(notification);
                  results.push({ channel: "sms", success: true });
                  break;

                default:
                  results.push({ channel, success: false, error: "Unknown channel" });
              }
            } catch (error) {
              results.push({ channel, success: false, error: error.message });
            }
          }

          return results;
        },

        /**
         * Send push notification
         */
        async sendPushNotification(notification) {
          const subscriptions = this.userSubscriptionsIndex.get(notification.userId) || [];

          for (const subId of subscriptions) {
            const sub = this.pushSubscriptions.get(subId);
            if (sub && sub.active) {
              // In production, integrate with FCM, APNS, etc.
              this.logger.debug(`Push to ${sub.platform}: ${notification.title}`);
            }
          }
        },

        /**
         * Send email notification
         */
        async sendEmailNotification(notification) {
          // In production, integrate with email service (SendGrid, SES, etc.)
          this.logger.debug(`Email: ${notification.title} to user ${notification.userId}`);
        },

        /**
         * Send WebSocket notification
         */
        async sendWebSocketNotification(notification) {
          // Emit event for Socket.IO to pick up
          this.broker.emit("notification.realtime", {
            userId: notification.userId,
            notification: {
              id: notification.id,
              type: notification.type,
              title: notification.title,
              message: notification.message,
              data: notification.data,
              createdAt: notification.createdAt,
            },
          });
        },

        /**
         * Send SMS notification
         */
        async sendSmsNotification(notification) {
          // In production, integrate with SMS service (Twilio, etc.)
          this.logger.debug(`SMS: ${notification.title} to user ${notification.userId}`);
        },

        /**
         * Save notification
         */
        async saveNotification(notification) {
          this.notifications.set(notification.id, notification);

          // Index by user
          const userNotifications = this.userNotificationsIndex.get(notification.userId) || [];
          if (!userNotifications.includes(notification.id)) {
            userNotifications.unshift(notification.id);
            this.userNotificationsIndex.set(notification.userId, userNotifications);
          }
        },

        /**
         * Get user notifications
         */
        getUserNotifications(userId, { page = 1, limit = 20, unreadOnly = false }) {
          const notificationIds = this.userNotificationsIndex.get(userId) || [];
          let notifications = notificationIds
            .map((id) => this.notifications.get(id))
            .filter(Boolean);

          if (unreadOnly) {
            notifications = notifications.filter((n) => !n.readAt);
          }

          const total = notifications.length;
          const start = (page - 1) * limit;
          const items = notifications.slice(start, start + limit);

          return {
            items,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
          };
        },

        /**
         * Get unread count
         */
        getUnreadCount(userId) {
          const notificationIds = this.userNotificationsIndex.get(userId) || [];
          return notificationIds
            .map((id) => this.notifications.get(id))
            .filter((n) => n && !n.readAt).length;
        },

        /**
         * Start queue processor
         */
        startQueueProcessor() {
          this.queueTimer = setInterval(() => {
            this.processQueue();
          }, this.settings.batchInterval);
        },

        /**
         * Stop queue processor
         */
        stopQueueProcessor() {
          if (this.queueTimer) {
            clearInterval(this.queueTimer);
            this.queueTimer = null;
          }
        },
      },

      created() {
        this.notifications = new Map();
        this.userNotificationsIndex = new Map();
        this.pushSubscriptions = new Map();
        this.userSubscriptionsIndex = new Map();
        this.pendingQueue = [];
        this.queueTimer = null;
      },

      async started() {
        this.logger.info("Notification service started");
        this.startQueueProcessor();
      },

      async stopped() {
        this.stopQueueProcessor();
        this.logger.info("Notification service stopped");
      },
    });
  }
};
