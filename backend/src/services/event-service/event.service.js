"use strict";

const { Service } = require("moleculer");
const { v4: uuidv4 } = require("uuid");

/**
 * Event Service
 * Handles sports, leagues, events, markets, and selections
 */
module.exports = class EventService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: "event",

      settings: {
        // Default pagination
        defaultLimit: 20,
        maxLimit: 100,
      },

      metadata: {
        description: "Sports events and markets management",
        version: "1.0.0",
      },

      dependencies: [],

      actions: {
        /**
         * Get all sports
         */
        sports: {
          rest: "GET /sports",
          cache: { keys: [], ttl: 300 },
          async handler(ctx) {
            return this.getSports();
          },
        },

        /**
         * Get leagues by sport
         */
        leagues: {
          rest: "GET /sports/:sportId/leagues",
          params: {
            sportId: { type: "uuid" },
          },
          cache: { keys: ["sportId"], ttl: 300 },
          async handler(ctx) {
            return this.getLeaguesBySport(ctx.params.sportId);
          },
        },

        /**
         * Get upcoming events
         */
        upcoming: {
          rest: "GET /events/upcoming",
          params: {
            sportId: { type: "uuid", optional: true },
            leagueId: { type: "uuid", optional: true },
            limit: { type: "number", integer: true, min: 1, max: 100, default: 20, optional: true },
            page: { type: "number", integer: true, min: 1, default: 1, optional: true },
          },
          cache: { keys: ["sportId", "leagueId", "limit", "page"], ttl: 30 },
          async handler(ctx) {
            const { sportId, leagueId, limit, page } = ctx.params;
            return this.getUpcomingEvents({ sportId, leagueId, limit, page });
          },
        },

        /**
         * Get live events
         */
        live: {
          rest: "GET /events/live",
          params: {
            sportId: { type: "uuid", optional: true },
          },
          cache: { keys: ["sportId"], ttl: 5 },
          async handler(ctx) {
            return this.getLiveEvents(ctx.params.sportId);
          },
        },

        /**
         * Get event by ID with markets
         */
        get: {
          rest: "GET /events/:id",
          params: {
            id: { type: "uuid" },
          },
          cache: { keys: ["id"], ttl: 10 },
          async handler(ctx) {
            const event = await this.getEventById(ctx.params.id);
            if (!event) {
              throw new this.broker.MoleculerClientError("Event not found", 404, "EVENT_NOT_FOUND");
            }
            return event;
          },
        },

        /**
         * Get markets for an event
         */
        markets: {
          rest: "GET /events/:eventId/markets",
          params: {
            eventId: { type: "uuid" },
          },
          cache: { keys: ["eventId"], ttl: 5 },
          async handler(ctx) {
            return this.getMarketsByEvent(ctx.params.eventId);
          },
        },

        /**
         * Get selection by ID
         */
        selection: {
          params: {
            id: { type: "uuid" },
          },
          cache: { keys: ["id"], ttl: 5 },
          async handler(ctx) {
            const selection = await this.getSelectionById(ctx.params.id);
            if (!selection) {
              throw new this.broker.MoleculerClientError("Selection not found", 404, "SELECTION_NOT_FOUND");
            }
            return selection;
          },
        },

        /**
         * Create a new event (admin)
         */
        create: {
          params: {
            sportId: { type: "uuid" },
            leagueId: { type: "uuid" },
            name: { type: "string", max: 300 },
            homeTeam: { type: "string", max: 150 },
            awayTeam: { type: "string", max: 150 },
            startTime: { type: "string" }, // ISO date string
          },
          visibility: "protected",
          async handler(ctx) {
            const { sportId, leagueId, name, homeTeam, awayTeam, startTime } = ctx.params;

            const event = {
              id: uuidv4(),
              sportId,
              leagueId,
              name,
              slug: this.slugify(name),
              homeTeam,
              awayTeam,
              startTime: new Date(startTime),
              status: "scheduled",
              homeScore: null,
              awayScore: null,
              metadata: {},
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            await this.saveEvent(event);

            // Create default markets
            await this.createDefaultMarkets(event);

            this.logger.info(`Event created: ${event.name}`);

            return event;
          },
        },

        /**
         * Update event status
         */
        updateStatus: {
          params: {
            eventId: { type: "uuid" },
            status: { type: "string", enum: ["scheduled", "live", "suspended", "finished", "cancelled", "postponed"] },
            homeScore: { type: "number", integer: true, optional: true },
            awayScore: { type: "number", integer: true, optional: true },
          },
          visibility: "protected",
          async handler(ctx) {
            const { eventId, status, homeScore, awayScore } = ctx.params;

            const event = await this.getEventById(eventId);
            if (!event) {
              throw new this.broker.MoleculerClientError("Event not found", 404, "EVENT_NOT_FOUND");
            }

            const previousStatus = event.status;
            event.status = status;
            if (homeScore !== undefined) event.homeScore = homeScore;
            if (awayScore !== undefined) event.awayScore = awayScore;
            event.updatedAt = new Date();

            await this.saveEvent(event);

            // Emit status change event
            this.broker.emit("event.statusChanged", {
              eventId,
              previousStatus,
              newStatus: status,
              homeScore: event.homeScore,
              awayScore: event.awayScore,
            });

            // If event finished, trigger settlement
            if (status === "finished") {
              this.broker.emit("event.finished", {
                eventId,
                homeScore: event.homeScore,
                awayScore: event.awayScore,
              });
            }

            this.logger.info(`Event ${eventId} status changed: ${previousStatus} -> ${status}`);

            return event;
          },
        },

        /**
         * Create a market for an event
         */
        createMarket: {
          params: {
            eventId: { type: "uuid" },
            name: { type: "string", max: 200 },
            type: { type: "string", max: 50 },
            selections: {
              type: "array",
              items: {
                type: "object",
                props: {
                  name: { type: "string" },
                  odds: { type: "number", positive: true },
                },
              },
            },
          },
          visibility: "protected",
          async handler(ctx) {
            const { eventId, name, type, selections } = ctx.params;

            const event = await this.getEventById(eventId);
            if (!event) {
              throw new this.broker.MoleculerClientError("Event not found", 404, "EVENT_NOT_FOUND");
            }

            const market = {
              id: uuidv4(),
              eventId,
              name,
              type,
              status: "open",
              sortOrder: 0,
              metadata: {},
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            await this.saveMarket(market);

            // Create selections
            for (let i = 0; i < selections.length; i++) {
              const selection = {
                id: uuidv4(),
                marketId: market.id,
                name: selections[i].name,
                odds: selections[i].odds,
                status: "active",
                sortOrder: i,
                metadata: {},
                createdAt: new Date(),
                updatedAt: new Date(),
              };
              await this.saveSelection(selection);
            }

            return this.getMarketWithSelections(market.id);
          },
        },

        /**
         * Update market status
         */
        updateMarketStatus: {
          params: {
            marketId: { type: "uuid" },
            status: { type: "string", enum: ["open", "suspended", "closed", "settled", "voided"] },
          },
          visibility: "protected",
          async handler(ctx) {
            const { marketId, status } = ctx.params;

            const market = this.markets.get(marketId);
            if (!market) {
              throw new this.broker.MoleculerClientError("Market not found", 404, "MARKET_NOT_FOUND");
            }

            market.status = status;
            market.updatedAt = new Date();
            await this.saveMarket(market);

            this.broker.emit("market.statusChanged", { marketId, status });

            return market;
          },
        },

        /**
         * Settle a selection (mark as winner/loser)
         */
        settleSelection: {
          params: {
            selectionId: { type: "uuid" },
            result: { type: "string", enum: ["winner", "loser", "void", "push"] },
          },
          visibility: "protected",
          async handler(ctx) {
            const { selectionId, result } = ctx.params;

            const selection = await this.getSelectionById(selectionId);
            if (!selection) {
              throw new this.broker.MoleculerClientError("Selection not found", 404, "SELECTION_NOT_FOUND");
            }

            selection.status = result;
            selection.updatedAt = new Date();
            await this.saveSelection(selection);

            this.broker.emit("selection.settled", {
              selectionId,
              marketId: selection.marketId,
              result,
            });

            return selection;
          },
        },

        /**
         * Search events
         */
        search: {
          rest: "GET /events/search",
          params: {
            query: { type: "string", min: 2 },
            limit: { type: "number", integer: true, min: 1, max: 50, default: 10, optional: true },
          },
          async handler(ctx) {
            const { query, limit } = ctx.params;
            return this.searchEvents(query, limit);
          },
        },

        /**
         * Ping for health checks
         */
        ping: {
          async handler() {
            return { status: "ok", service: "event", timestamp: Date.now() };
          },
        },
      },

      events: {
        /**
         * Handle odds updates from odds-service
         */
        "odds.updated"(ctx) {
          const { selectionId, odds } = ctx.params;
          this.updateSelectionOdds(selectionId, odds);
        },
      },

      methods: {
        /**
         * Generate slug from name
         */
        slugify(text) {
          return text
            .toLowerCase()
            .replace(/[^\w\s-]/g, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .trim();
        },

        /**
         * Create default markets for an event
         */
        async createDefaultMarkets(event) {
          // Match Result (1X2)
          const matchResultMarket = {
            id: uuidv4(),
            eventId: event.id,
            name: "Match Result",
            type: "1x2",
            status: "open",
            sortOrder: 1,
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          await this.saveMarket(matchResultMarket);

          const selections1x2 = [
            { name: event.homeTeam, odds: 2.0 },
            { name: "Draw", odds: 3.5 },
            { name: event.awayTeam, odds: 3.0 },
          ];

          for (let i = 0; i < selections1x2.length; i++) {
            await this.saveSelection({
              id: uuidv4(),
              marketId: matchResultMarket.id,
              name: selections1x2[i].name,
              odds: selections1x2[i].odds,
              status: "active",
              sortOrder: i,
              metadata: {},
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }

          // Over/Under 2.5 Goals
          const ouMarket = {
            id: uuidv4(),
            eventId: event.id,
            name: "Total Goals Over/Under 2.5",
            type: "over_under",
            status: "open",
            sortOrder: 2,
            metadata: { line: 2.5 },
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          await this.saveMarket(ouMarket);

          const selectionsOU = [
            { name: "Over 2.5", odds: 1.85 },
            { name: "Under 2.5", odds: 1.95 },
          ];

          for (let i = 0; i < selectionsOU.length; i++) {
            await this.saveSelection({
              id: uuidv4(),
              marketId: ouMarket.id,
              name: selectionsOU[i].name,
              odds: selectionsOU[i].odds,
              status: "active",
              sortOrder: i,
              metadata: {},
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
        },

        /**
         * Update selection odds
         */
        async updateSelectionOdds(selectionId, newOdds) {
          const selection = await this.getSelectionById(selectionId);
          if (selection) {
            selection.odds = newOdds;
            selection.updatedAt = new Date();
            await this.saveSelection(selection);
          }
        },

        // Data access methods (in-memory, replace with DB)
        getSports() {
          return Array.from(this.sports.values()).sort((a, b) => a.sortOrder - b.sortOrder);
        },

        getLeaguesBySport(sportId) {
          return Array.from(this.leagues.values())
            .filter((l) => l.sportId === sportId && l.isActive)
            .sort((a, b) => a.sortOrder - b.sortOrder);
        },

        async getUpcomingEvents({ sportId, leagueId, limit = 20, page = 1 }) {
          const now = new Date();
          let events = Array.from(this.eventsStore.values())
            .filter((e) => e.status === "scheduled" && new Date(e.startTime) > now)
            .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

          if (sportId) events = events.filter((e) => e.sportId === sportId);
          if (leagueId) events = events.filter((e) => e.leagueId === leagueId);

          const total = events.length;
          const start = (page - 1) * limit;
          const items = events.slice(start, start + limit);

          return {
            items,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
          };
        },

        getLiveEvents(sportId) {
          let events = Array.from(this.eventsStore.values())
            .filter((e) => e.status === "live")
            .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

          if (sportId) events = events.filter((e) => e.sportId === sportId);

          return events;
        },

        async getEventById(id) {
          const event = this.eventsStore.get(id);
          if (!event) return null;

          // Include markets
          const markets = await this.getMarketsByEvent(id);
          return { ...event, markets };
        },

        async getMarketsByEvent(eventId) {
          const markets = Array.from(this.markets.values())
            .filter((m) => m.eventId === eventId)
            .sort((a, b) => a.sortOrder - b.sortOrder);

          // Include selections for each market
          return Promise.all(
            markets.map(async (market) => {
              const selections = await this.getSelectionsByMarket(market.id);
              return { ...market, selections };
            })
          );
        },

        async getMarketWithSelections(marketId) {
          const market = this.markets.get(marketId);
          if (!market) return null;
          const selections = await this.getSelectionsByMarket(marketId);
          return { ...market, selections };
        },

        async getSelectionsByMarket(marketId) {
          return Array.from(this.selections.values())
            .filter((s) => s.marketId === marketId)
            .sort((a, b) => a.sortOrder - b.sortOrder);
        },

        async getSelectionById(id) {
          return this.selections.get(id);
        },

        searchEvents(query, limit) {
          const lowerQuery = query.toLowerCase();
          return Array.from(this.eventsStore.values())
            .filter(
              (e) =>
                e.name.toLowerCase().includes(lowerQuery) ||
                e.homeTeam?.toLowerCase().includes(lowerQuery) ||
                e.awayTeam?.toLowerCase().includes(lowerQuery)
            )
            .slice(0, limit);
        },

        async saveEvent(event) {
          this.eventsStore.set(event.id, event);
        },

        async saveMarket(market) {
          this.markets.set(market.id, market);
        },

        async saveSelection(selection) {
          this.selections.set(selection.id, selection);
        },

        /**
         * Initialize sample data
         */
        initializeSampleData() {
          // Sports
          const sports = [
            { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", name: "Football", slug: "football", sortOrder: 1, isActive: true },
            { id: "b2c3d4e5-f6a7-8901-bcde-f12345678901", name: "Basketball", slug: "basketball", sortOrder: 2, isActive: true },
            { id: "c3d4e5f6-a7b8-9012-cdef-123456789012", name: "Tennis", slug: "tennis", sortOrder: 3, isActive: true },
          ];
          sports.forEach((s) => this.sports.set(s.id, s));

          // Leagues
          const leagues = [
            { id: uuidv4(), sportId: sports[0].id, name: "Premier League", slug: "premier-league", country: "England", sortOrder: 1, isActive: true },
            { id: uuidv4(), sportId: sports[0].id, name: "La Liga", slug: "la-liga", country: "Spain", sortOrder: 2, isActive: true },
            { id: uuidv4(), sportId: sports[1].id, name: "NBA", slug: "nba", country: "USA", sortOrder: 1, isActive: true },
          ];
          leagues.forEach((l) => this.leagues.set(l.id, l));

          // Sample events
          const now = new Date();
          const sampleEvents = [
            {
              sportId: sports[0].id,
              leagueId: leagues[0].id,
              name: "Manchester United vs Liverpool",
              homeTeam: "Manchester United",
              awayTeam: "Liverpool",
              startTime: new Date(now.getTime() + 2 * 60 * 60 * 1000), // 2 hours from now
            },
            {
              sportId: sports[0].id,
              leagueId: leagues[0].id,
              name: "Arsenal vs Chelsea",
              homeTeam: "Arsenal",
              awayTeam: "Chelsea",
              startTime: new Date(now.getTime() + 4 * 60 * 60 * 1000), // 4 hours from now
            },
            {
              sportId: sports[1].id,
              leagueId: leagues[2].id,
              name: "Lakers vs Warriors",
              homeTeam: "LA Lakers",
              awayTeam: "Golden State Warriors",
              startTime: new Date(now.getTime() + 6 * 60 * 60 * 1000), // 6 hours from now
            },
          ];

          sampleEvents.forEach((eventData) => {
            const event = {
              id: uuidv4(),
              ...eventData,
              slug: this.slugify(eventData.name),
              status: "scheduled",
              homeScore: null,
              awayScore: null,
              metadata: {},
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            this.eventsStore.set(event.id, event);
            this.createDefaultMarkets(event);
          });

          this.logger.info(`Initialized ${sampleEvents.length} sample events`);
        },
      },

      created() {
        // In-memory stores
        this.sports = new Map();
        this.leagues = new Map();
        this.eventsStore = new Map();
        this.markets = new Map();
        this.selections = new Map();
      },

      async started() {
        this.logger.info("Event service started");
        this.initializeSampleData();
      },

      async stopped() {
        this.logger.info("Event service stopped");
      },
    });
  }
};
