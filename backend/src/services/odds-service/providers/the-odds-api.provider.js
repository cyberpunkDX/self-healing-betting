"use strict";

const BaseOddsProvider = require("./base.provider");
const { v4: uuidv4 } = require("uuid");

/**
 * The Odds API Provider
 * https://the-odds-api.com/
 *
 * Provides real-time odds from multiple bookmakers for major sports
 */
class TheOddsApiProvider extends BaseOddsProvider {
  constructor(config = {}) {
    super(config);

    this.name = "the-odds-api";
    this.apiKey = config.apiKey || process.env.ODDS_API_KEY;
    this.baseUrl = config.baseUrl || "https://api.the-odds-api.com/v4";
    this.preferredBookmaker = config.preferredBookmaker || "pinnacle";
    this.region = config.region || "us"; // us, uk, eu, au
    this.oddsFormat = config.oddsFormat || "decimal";

    // Rate limiting
    this.requestsRemaining = null;
    this.requestsUsed = null;

    // Cache for reducing API calls
    this.cache = new Map();
    this.cacheTTL = config.cacheTTL || 30000; // 30 seconds

    // Polling for live updates
    this.pollInterval = config.pollInterval || 30000; // 30 seconds
    this.pollTimers = new Map();
    this.subscribers = new Map();
  }

  /**
   * Initialize the provider
   */
  async initialize() {
    if (!this.apiKey) {
      throw new Error("The Odds API key is required. Set ODDS_API_KEY environment variable.");
    }

    try {
      // Test connection by fetching sports
      await this.getSports();
      this.isConnected = true;
      return true;
    } catch (error) {
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Make API request with error handling
   */
  async request(endpoint, params = {}) {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.append("apiKey", this.apiKey);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    }

    const response = await fetch(url.toString());

    // Track quota from headers
    this.requestsRemaining = response.headers.get("x-requests-remaining");
    this.requestsUsed = response.headers.get("x-requests-used");

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`The Odds API error: ${response.status} - ${error}`);
    }

    this.lastSync = new Date();
    return response.json();
  }

  /**
   * Get cached data or fetch fresh
   */
  async getCached(key, fetcher) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    const data = await fetcher();
    this.cache.set(key, { data, timestamp: Date.now() });
    return data;
  }

  /**
   * Get list of available sports
   */
  async getSports() {
    return this.getCached("sports", async () => {
      const sports = await this.request("/sports");
      return sports
        .filter((s) => s.active)
        .map((s) => ({
          id: s.key,
          key: s.key,
          name: s.title,
          group: s.group,
          description: s.description,
          hasOutrights: s.has_outrights,
        }));
    });
  }

  /**
   * Get events for a sport
   */
  async getEvents(sportKey, options = {}) {
    const cacheKey = `events:${sportKey}`;
    return this.getCached(cacheKey, async () => {
      const events = await this.request(`/sports/${sportKey}/events`, {
        dateFormat: "iso",
      });

      return events.map((e) => this.transformEvent(e, sportKey));
    });
  }

  /**
   * Get odds for all events in a sport
   */
  async getOdds(sportKey, options = {}) {
    const {
      markets = "h2h,spreads,totals",
      bookmakers,
    } = options;

    const cacheKey = `odds:${sportKey}:${markets}`;
    return this.getCached(cacheKey, async () => {
      const data = await this.request(`/sports/${sportKey}/odds`, {
        regions: this.region,
        markets,
        oddsFormat: this.oddsFormat,
        bookmakers: bookmakers || this.preferredBookmaker,
      });

      return data.map((event) => this.transformEventWithOdds(event, sportKey));
    });
  }

  /**
   * Get odds for a specific event
   */
  async getEventOdds(sportKey, eventId, options = {}) {
    const {
      markets = "h2h,spreads,totals",
      bookmakers,
    } = options;

    const cacheKey = `event-odds:${eventId}:${markets}`;
    return this.getCached(cacheKey, async () => {
      const data = await this.request(`/sports/${sportKey}/events/${eventId}/odds`, {
        regions: this.region,
        markets,
        oddsFormat: this.oddsFormat,
        bookmakers: bookmakers || this.preferredBookmaker,
      });

      return this.transformEventWithOdds(data, sportKey);
    });
  }

  /**
   * Subscribe to live odds updates via polling
   */
  async subscribe(eventId, callback, sportKey) {
    const subscriptionId = uuidv4();

    this.subscribers.set(subscriptionId, {
      eventId,
      sportKey,
      callback,
    });

    // Start polling if not already
    if (!this.pollTimers.has(eventId)) {
      const timer = setInterval(async () => {
        try {
          const odds = await this.getEventOdds(sportKey, eventId);
          // Clear cache to force fresh fetch
          this.cache.delete(`event-odds:${eventId}:h2h,spreads,totals`);

          // Notify all subscribers for this event
          for (const [subId, sub] of this.subscribers.entries()) {
            if (sub.eventId === eventId) {
              sub.callback(odds);
            }
          }
        } catch (error) {
          console.error(`Failed to poll odds for event ${eventId}:`, error.message);
        }
      }, this.pollInterval);

      this.pollTimers.set(eventId, timer);
    }

    return subscriptionId;
  }

  /**
   * Unsubscribe from live odds updates
   */
  async unsubscribe(subscriptionId) {
    const sub = this.subscribers.get(subscriptionId);
    if (!sub) return;

    this.subscribers.delete(subscriptionId);

    // Check if any other subscribers for this event
    const eventId = sub.eventId;
    let hasOtherSubscribers = false;
    for (const s of this.subscribers.values()) {
      if (s.eventId === eventId) {
        hasOtherSubscribers = true;
        break;
      }
    }

    // Stop polling if no more subscribers
    if (!hasOtherSubscribers && this.pollTimers.has(eventId)) {
      clearInterval(this.pollTimers.get(eventId));
      this.pollTimers.delete(eventId);
    }
  }

  /**
   * Get provider status
   */
  async getStatus() {
    return {
      name: this.name,
      isConnected: this.isConnected,
      lastSync: this.lastSync,
      quota: {
        remaining: this.requestsRemaining,
        used: this.requestsUsed,
      },
      region: this.region,
      preferredBookmaker: this.preferredBookmaker,
      activeSubscriptions: this.subscribers.size,
    };
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect() {
    // Stop all polling timers
    for (const timer of this.pollTimers.values()) {
      clearInterval(timer);
    }
    this.pollTimers.clear();
    this.subscribers.clear();
    this.cache.clear();
    this.isConnected = false;
  }

  /**
   * Transform external event to internal format
   */
  transformEvent(externalEvent, sportKey) {
    return {
      id: externalEvent.id,
      externalId: externalEvent.id,
      sportKey,
      name: `${externalEvent.home_team} vs ${externalEvent.away_team}`,
      homeTeam: externalEvent.home_team,
      awayTeam: externalEvent.away_team,
      startTime: new Date(externalEvent.commence_time),
      status: this.determineEventStatus(externalEvent.commence_time),
    };
  }

  /**
   * Transform external event with odds to internal format
   */
  transformEventWithOdds(externalEvent, sportKey) {
    const event = this.transformEvent(externalEvent, sportKey);
    const markets = [];

    if (externalEvent.bookmakers && externalEvent.bookmakers.length > 0) {
      // Use preferred bookmaker or first available
      const bookmaker =
        externalEvent.bookmakers.find((b) => b.key === this.preferredBookmaker) ||
        externalEvent.bookmakers[0];

      for (const market of bookmaker.markets || []) {
        markets.push(this.transformMarket(market, event.id));
      }
    }

    return {
      ...event,
      bookmaker: externalEvent.bookmakers?.[0]?.title,
      markets,
    };
  }

  /**
   * Transform market data
   */
  transformMarket(externalMarket, eventId) {
    const marketTypeMap = {
      h2h: { name: "Match Result", type: "1x2" },
      spreads: { name: "Spread", type: "spread" },
      totals: { name: "Total", type: "over_under" },
      outrights: { name: "Outright Winner", type: "outright" },
    };

    const marketInfo = marketTypeMap[externalMarket.key] || {
      name: externalMarket.key,
      type: externalMarket.key,
    };

    const selections = externalMarket.outcomes.map((outcome, index) => ({
      id: uuidv4(),
      name: this.formatOutcomeName(outcome, externalMarket.key),
      odds: outcome.price,
      point: outcome.point, // For spreads/totals
      status: "active",
      sortOrder: index,
    }));

    return {
      id: uuidv4(),
      eventId,
      name: marketInfo.name,
      type: marketInfo.type,
      externalKey: externalMarket.key,
      status: "open",
      lastUpdate: new Date(externalMarket.last_update),
      selections,
    };
  }

  /**
   * Format outcome name based on market type
   */
  formatOutcomeName(outcome, marketKey) {
    if (marketKey === "totals") {
      return `${outcome.name} ${outcome.point}`;
    }
    if (marketKey === "spreads" && outcome.point) {
      const sign = outcome.point > 0 ? "+" : "";
      return `${outcome.name} (${sign}${outcome.point})`;
    }
    return outcome.name;
  }

  /**
   * Determine event status based on start time
   */
  determineEventStatus(commenceTime) {
    const now = new Date();
    const start = new Date(commenceTime);

    if (start > now) {
      return "scheduled";
    }
    // Rough estimate - events typically last 2-3 hours
    const threeHoursLater = new Date(start.getTime() + 3 * 60 * 60 * 1000);
    if (now < threeHoursLater) {
      return "live";
    }
    return "finished";
  }
}

module.exports = TheOddsApiProvider;
