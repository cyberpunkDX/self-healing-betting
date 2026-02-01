"use strict";

const { Service } = require("moleculer");
const ApiGateway = require("moleculer-web");

/**
 * API Gateway Service
 * HTTP/REST and WebSocket entry point
 */
module.exports = class ApiGatewayService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: "api-gateway",

      mixins: [ApiGateway],

      settings: {
        port: parseInt(process.env.API_PORT, 10) || 3000,
        ip: process.env.API_HOST || "0.0.0.0",

        // Global CORS settings
        cors: {
          origin: process.env.CORS_ORIGIN || "*",
          methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
          allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
          exposedHeaders: ["X-Request-ID", "X-RateLimit-Remaining"],
          credentials: true,
          maxAge: 3600,
        },

        // Rate limiting
        rateLimit: {
          window: parseInt(process.env.RATE_LIMIT_WINDOW, 10) || 60000,
          limit: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
          headers: true,
          key: (req) => {
            return req.headers["x-forwarded-for"] ||
              req.connection.remoteAddress ||
              req.headers.authorization ||
              "anonymous";
          },
        },

        // Routes
        routes: [
          // Health check routes (no auth)
          {
            path: "/health",
            aliases: {
              "GET /": "api-gateway.health",
              "GET /ready": "api-gateway.ready",
              "GET /live": "api-gateway.live",
            },
          },

          // Auth routes (no auth required)
          {
            path: "/api/auth",
            aliases: {
              "POST /register": "user.register",
              "POST /login": "user.login",
              "POST /refresh": "user.refresh",
            },
            bodyParsers: {
              json: { limit: "1MB" },
            },
          },

          // Protected user routes
          {
            path: "/api/user",
            authorization: true,
            aliases: {
              "GET /me": "user.me",
              "PATCH /profile": "user.updateProfile",
              "POST /change-password": "user.changePassword",
              "POST /logout": "user.logout",
            },
            bodyParsers: {
              json: { limit: "1MB" },
            },
          },

          // Wallet routes (protected)
          {
            path: "/api/wallet",
            authorization: true,
            aliases: {
              "GET /balance": "wallet.balance",
              "POST /deposit": "wallet.deposit",
              "POST /withdraw": "wallet.withdraw",
              "GET /transactions": "wallet.transactions",
            },
            bodyParsers: {
              json: { limit: "1MB" },
            },
          },

          // Event routes (public)
          {
            path: "/api/events",
            aliases: {
              "GET /sports": "event.sports",
              "GET /sports/:sportId/leagues": "event.leagues",
              "GET /upcoming": "event.upcoming",
              "GET /live": "event.live",
              "GET /search": "event.search",
              "GET /:id": "event.get",
              "GET /:eventId/markets": "event.markets",
            },
          },

          // Odds routes (public)
          {
            path: "/api/odds",
            aliases: {
              "GET /sports": "odds.sports",
              "GET /sports/:sportKey/events": "odds.sportEvents",
              "GET /event/:eventId": "odds.event",
              "GET /market/:marketId": "odds.market",
              "GET /selection/:selectionId": "odds.get",
              "GET /selection/:selectionId/history": "odds.history",
              "GET /provider/status": "odds.providerStatus",
            },
          },

          // Betting routes (protected)
          {
            path: "/api/bet",
            authorization: true,
            aliases: {
              "POST /place": "bet.place",
              "POST /place/accumulator": "bet.placeAccumulator",
              "GET /history": "bet.history",
              "GET /open": "bet.openBets",
              "GET /:id": "bet.get",
              "GET /:id/cashout-value": "bet.getCashoutValue",
              "POST /:id/cashout": "bet.cashout",
            },
            bodyParsers: {
              json: { limit: "1MB" },
            },
          },

          // Notification routes (protected)
          {
            path: "/api/notifications",
            authorization: true,
            aliases: {
              "GET /": "notification.list",
              "GET /unread/count": "notification.unreadCount",
              "POST /:id/read": "notification.markAsRead",
              "POST /read-all": "notification.markAllAsRead",
              "DELETE /:id": "notification.delete",
              "POST /subscribe": "notification.subscribe",
              "DELETE /subscribe/:id": "notification.unsubscribe",
            },
            bodyParsers: {
              json: { limit: "1MB" },
            },
          },

          // Health monitor routes (public)
          {
            path: "/api/health",
            aliases: {
              "GET /status": "health-monitor.status",
              "GET /services": "health-monitor.services",
              "GET /nodes": "health-monitor.nodes",
            },
          },
        ],

        // Global error handler
        onError(req, res, err) {
          res.setHeader("Content-Type", "application/json");

          const statusCode = err.code || 500;
          res.writeHead(statusCode);

          res.end(JSON.stringify({
            success: false,
            error: {
              message: err.message,
              code: err.type || "INTERNAL_ERROR",
              data: err.data,
            },
            requestId: req.$ctx?.meta?.requestId,
          }));
        },

        // Assets (if needed)
        assets: {
          folder: "public",
          options: {},
        },
      },

      metadata: {
        description: "API Gateway - HTTP/REST entry point",
        version: "1.0.0",
      },

      actions: {
        /**
         * Health check
         */
        health: {
          rest: "GET /",
          async handler(ctx) {
            return {
              status: "ok",
              timestamp: new Date().toISOString(),
              uptime: process.uptime(),
            };
          },
        },

        /**
         * Readiness probe
         */
        ready: {
          async handler(ctx) {
            // Check if essential services are available
            const services = ["user", "wallet", "event", "odds", "bet"];
            const unavailable = [];

            for (const service of services) {
              try {
                await ctx.call(`${service}.ping`, {}, { timeout: 2000 });
              } catch (error) {
                unavailable.push(service);
              }
            }

            if (unavailable.length > 0) {
              ctx.meta.$statusCode = 503;
              return {
                status: "not_ready",
                unavailableServices: unavailable,
              };
            }

            return { status: "ready" };
          },
        },

        /**
         * Liveness probe
         */
        live: {
          async handler(ctx) {
            return { status: "alive", timestamp: Date.now() };
          },
        },
      },

      methods: {
        /**
         * Authorize the request
         */
        async authorize(ctx, route, req) {
          const authHeader = req.headers.authorization;

          if (!authHeader || !authHeader.startsWith("Bearer ")) {
            throw new this.broker.MoleculerClientError(
              "Authorization header required",
              401,
              "NO_TOKEN"
            );
          }

          const token = authHeader.substring(7);

          try {
            const result = await ctx.call("user.verifyToken", { token });

            if (!result.valid) {
              throw new this.broker.MoleculerClientError(
                result.error || "Invalid token",
                401,
                "INVALID_TOKEN"
              );
            }

            // Add user info to context meta
            ctx.meta.userId = result.userId;
            ctx.meta.email = result.email;
            ctx.meta.username = result.username;
            ctx.meta.token = token;
          } catch (error) {
            if (error.code === 401) throw error;
            throw new this.broker.MoleculerClientError(
              "Authentication failed",
              401,
              "AUTH_FAILED"
            );
          }
        },

        /**
         * Add request metadata
         */
        async onBeforeCall(ctx, route, req) {
          // Add request ID
          ctx.meta.requestId = req.headers["x-request-id"] || this.generateRequestId();

          // Add client info
          ctx.meta.ip = req.headers["x-forwarded-for"] ||
            req.connection.remoteAddress;
          ctx.meta.userAgent = req.headers["user-agent"];
        },

        /**
         * Generate request ID
         */
        generateRequestId() {
          return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        },
      },

      created() {
        this.logger.info("API Gateway created");
      },

      async started() {
        this.logger.info(`API Gateway started on port ${this.settings.port}`);
      },

      async stopped() {
        this.logger.info("API Gateway stopped");
      },
    });
  }
};
