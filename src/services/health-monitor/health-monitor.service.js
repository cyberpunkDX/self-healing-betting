"use strict";

const { Service } = require("moleculer");

/**
 * Health Monitor Service
 * Monitors service health, collects metrics, and orchestrates self-healing
 */
module.exports = class HealthMonitorService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: "health-monitor",

      settings: {
        // Health check interval in ms
        checkInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL, 10) || 30000,

        // Threshold for unhealthy status
        unhealthyThreshold: 3,

        // Services to monitor
        monitoredServices: [
          "api-gateway",
          "bet-service",
          "user-service",
          "odds-service",
          "wallet-service",
          "event-service",
          "settlement-service",
          "notification-service",
        ],
      },

      metadata: {
        description: "Service health monitoring and self-healing orchestration",
        version: "1.0.0",
      },

      // Service dependencies
      dependencies: [],

      // Actions
      actions: {
        /**
         * Get overall system health status
         */
        status: {
          rest: "GET /status",
          cache: {
            keys: [],
            ttl: 5,
          },
          async handler(ctx) {
            return this.getSystemHealth();
          },
        },

        /**
         * Get health of a specific service
         */
        service: {
          rest: "GET /service/:serviceName",
          params: {
            serviceName: "string",
          },
          async handler(ctx) {
            return this.getServiceHealth(ctx.params.serviceName);
          },
        },

        /**
         * Get all services health
         */
        services: {
          rest: "GET /services",
          cache: {
            keys: [],
            ttl: 5,
          },
          async handler(ctx) {
            return this.getAllServicesHealth();
          },
        },

        /**
         * Get circuit breaker status for all services
         */
        circuitBreakers: {
          rest: "GET /circuit-breakers",
          async handler(ctx) {
            return this.getCircuitBreakerStatus();
          },
        },

        /**
         * Get node information
         */
        nodes: {
          rest: "GET /nodes",
          async handler(ctx) {
            return this.getNodesInfo();
          },
        },

        /**
         * Trigger health check for all services
         */
        check: {
          rest: "POST /check",
          async handler(ctx) {
            return this.runHealthChecks();
          },
        },

        /**
         * Get metrics summary
         */
        metrics: {
          rest: "GET /metrics",
          async handler(ctx) {
            return this.getMetricsSummary();
          },
        },

        /**
         * Ping endpoint for load balancer health checks
         */
        ping: {
          rest: "GET /ping",
          async handler(ctx) {
            return {
              status: "ok",
              timestamp: new Date().toISOString(),
              nodeID: this.broker.nodeID,
            };
          },
        },
      },

      // Events
      events: {
        /**
         * Handle service started events
         */
        "$node.connected"(ctx) {
          this.logger.info(`Node connected: ${ctx.params.node.id}`);
          this.serviceHealthMap.set(ctx.params.node.id, {
            status: "healthy",
            lastCheck: Date.now(),
            consecutiveFailures: 0,
          });
        },

        /**
         * Handle service stopped events
         */
        "$node.disconnected"(ctx) {
          this.logger.warn(`Node disconnected: ${ctx.params.node.id}`);
          this.serviceHealthMap.delete(ctx.params.node.id);
        },

        /**
         * Handle circuit breaker opened
         */
        "$circuit-breaker.opened"(ctx) {
          this.logger.error(`Circuit breaker OPENED for: ${ctx.params.action}`);
          this.circuitBreakerEvents.push({
            action: ctx.params.action,
            event: "opened",
            timestamp: Date.now(),
          });
        },

        /**
         * Handle circuit breaker closed
         */
        "$circuit-breaker.closed"(ctx) {
          this.logger.info(`Circuit breaker CLOSED for: ${ctx.params.action}`);
          this.circuitBreakerEvents.push({
            action: ctx.params.action,
            event: "closed",
            timestamp: Date.now(),
          });
        },

        /**
         * Handle circuit breaker half-opened
         */
        "$circuit-breaker.half-opened"(ctx) {
          this.logger.info(`Circuit breaker HALF-OPENED for: ${ctx.params.action}`);
          this.circuitBreakerEvents.push({
            action: ctx.params.action,
            event: "half-opened",
            timestamp: Date.now(),
          });
        },
      },

      // Methods
      methods: {
        /**
         * Get overall system health
         */
        async getSystemHealth() {
          const services = await this.getAllServicesHealth();
          const healthyCount = services.filter((s) => s.status === "healthy").length;
          const totalCount = services.length;

          let status = "healthy";
          if (healthyCount === 0) {
            status = "critical";
          } else if (healthyCount < totalCount) {
            status = "degraded";
          }

          return {
            status,
            timestamp: new Date().toISOString(),
            nodeID: this.broker.nodeID,
            summary: {
              total: totalCount,
              healthy: healthyCount,
              unhealthy: totalCount - healthyCount,
            },
            services,
          };
        },

        /**
         * Get health status of a specific service
         */
        async getServiceHealth(serviceName) {
          const services = this.broker.registry.getServiceList({
            withActions: true,
            withEvents: true,
          });

          const service = services.find((s) => s.name === serviceName);

          if (!service) {
            return {
              name: serviceName,
              status: "not_found",
              available: false,
            };
          }

          // Try to ping the service
          let pingResult = null;
          try {
            const startTime = Date.now();
            await this.broker.call(`${serviceName}.ping`, {}, { timeout: 5000 });
            pingResult = {
              success: true,
              latency: Date.now() - startTime,
            };
          } catch (error) {
            pingResult = {
              success: false,
              error: error.message,
            };
          }

          const healthData = this.serviceHealthMap.get(serviceName) || {
            status: "unknown",
            consecutiveFailures: 0,
          };

          return {
            name: serviceName,
            status: pingResult.success ? "healthy" : "unhealthy",
            available: service.available,
            nodes: service.nodes?.length || 0,
            actions: Object.keys(service.actions || {}).length,
            ping: pingResult,
            health: healthData,
          };
        },

        /**
         * Get health of all monitored services
         */
        async getAllServicesHealth() {
          const services = this.broker.registry.getServiceList({
            withActions: false,
            withEvents: false,
          });

          const results = [];

          for (const service of services) {
            // Skip internal services
            if (service.name.startsWith("$")) continue;

            const healthData = this.serviceHealthMap.get(service.name) || {
              status: "unknown",
              consecutiveFailures: 0,
            };

            results.push({
              name: service.name,
              status: service.available ? healthData.status : "unavailable",
              available: service.available,
              nodes: service.nodes?.length || 0,
              version: service.version,
              lastCheck: healthData.lastCheck
                ? new Date(healthData.lastCheck).toISOString()
                : null,
            });
          }

          return results;
        },

        /**
         * Get circuit breaker status
         */
        getCircuitBreakerStatus() {
          // Get recent circuit breaker events (last 100)
          const recentEvents = this.circuitBreakerEvents.slice(-100);

          // Group by action
          const actionStatus = {};
          for (const event of recentEvents) {
            actionStatus[event.action] = {
              status: event.event,
              timestamp: new Date(event.timestamp).toISOString(),
            };
          }

          return {
            events: recentEvents.slice(-20).map((e) => ({
              ...e,
              timestamp: new Date(e.timestamp).toISOString(),
            })),
            actions: actionStatus,
          };
        },

        /**
         * Get all nodes information
         */
        getNodesInfo() {
          const nodes = this.broker.registry.getNodeList({
            withServices: true,
          });

          return nodes.map((node) => ({
            id: node.id,
            available: node.available,
            local: node.local,
            lastHeartbeat: node.lastHeartbeat
              ? new Date(node.lastHeartbeat).toISOString()
              : null,
            cpu: node.cpu,
            cpuSeq: node.cpuSeq,
            services: node.services?.map((s) => s.name) || [],
          }));
        },

        /**
         * Run health checks on all services
         */
        async runHealthChecks() {
          const results = [];

          for (const serviceName of this.settings.monitoredServices) {
            try {
              const startTime = Date.now();
              await this.broker.call(`${serviceName}.ping`, {}, { timeout: 5000 });

              const healthData = this.serviceHealthMap.get(serviceName) || {};
              this.serviceHealthMap.set(serviceName, {
                status: "healthy",
                lastCheck: Date.now(),
                latency: Date.now() - startTime,
                consecutiveFailures: 0,
              });

              results.push({
                service: serviceName,
                status: "healthy",
                latency: Date.now() - startTime,
              });
            } catch (error) {
              const healthData = this.serviceHealthMap.get(serviceName) || {
                consecutiveFailures: 0,
              };
              const failures = healthData.consecutiveFailures + 1;

              this.serviceHealthMap.set(serviceName, {
                status: failures >= this.settings.unhealthyThreshold ? "unhealthy" : "degraded",
                lastCheck: Date.now(),
                consecutiveFailures: failures,
                lastError: error.message,
              });

              results.push({
                service: serviceName,
                status: "failed",
                error: error.message,
                consecutiveFailures: failures,
              });

              // Emit event for unhealthy service
              if (failures >= this.settings.unhealthyThreshold) {
                this.broker.emit("health.service.unhealthy", {
                  service: serviceName,
                  failures,
                  error: error.message,
                });
              }
            }
          }

          return {
            timestamp: new Date().toISOString(),
            results,
          };
        },

        /**
         * Get metrics summary
         */
        async getMetricsSummary() {
          const metrics = this.broker.metrics;

          if (!metrics) {
            return { enabled: false };
          }

          // Get key metrics
          const summary = {
            enabled: true,
            timestamp: new Date().toISOString(),
            requests: {},
            latency: {},
            errors: {},
          };

          try {
            const metricsList = metrics.list();

            for (const metric of metricsList) {
              if (metric.name.includes("request.total")) {
                summary.requests[metric.labelName || "total"] = metric.value;
              }
              if (metric.name.includes("request.time")) {
                summary.latency[metric.labelName || "avg"] = metric.value;
              }
              if (metric.name.includes("request.error")) {
                summary.errors[metric.labelName || "total"] = metric.value;
              }
            }
          } catch (error) {
            summary.error = error.message;
          }

          return summary;
        },

        /**
         * Start periodic health checks
         */
        startHealthCheckTimer() {
          this.healthCheckTimer = setInterval(() => {
            this.runHealthChecks().catch((err) => {
              this.logger.error("Health check failed:", err);
            });
          }, this.settings.checkInterval);
        },

        /**
         * Stop periodic health checks
         */
        stopHealthCheckTimer() {
          if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
          }
        },
      },

      // Lifecycle hooks
      created() {
        this.serviceHealthMap = new Map();
        this.circuitBreakerEvents = [];
        this.healthCheckTimer = null;
      },

      async started() {
        this.logger.info("Health Monitor service started");
        this.startHealthCheckTimer();

        // Run initial health check after a delay
        setTimeout(() => {
          this.runHealthChecks().catch((err) => {
            this.logger.error("Initial health check failed:", err);
          });
        }, 5000);
      },

      async stopped() {
        this.stopHealthCheckTimer();
        this.logger.info("Health Monitor service stopped");
      },
    });
  }
};
