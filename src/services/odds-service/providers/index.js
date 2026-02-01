"use strict";

const BaseOddsProvider = require("./base.provider");
const TheOddsApiProvider = require("./the-odds-api.provider");

/**
 * Provider factory
 * Creates the appropriate odds provider based on configuration
 */
function createProvider(type, config = {}) {
  switch (type) {
    case "the-odds-api":
      return new TheOddsApiProvider(config);

    case "mock":
    case "simulation":
      // Return a mock provider for testing
      return new MockProvider(config);

    default:
      throw new Error(`Unknown odds provider type: ${type}`);
  }
}

/**
 * Mock Provider for testing and development without API key
 */
class MockProvider extends BaseOddsProvider {
  constructor(config = {}) {
    super(config);
    this.name = "mock";
  }

  async initialize() {
    this.isConnected = true;
    return true;
  }

  async getSports() {
    return [
      { id: "soccer_epl", key: "soccer_epl", name: "EPL", group: "Soccer" },
      { id: "basketball_nba", key: "basketball_nba", name: "NBA", group: "Basketball" },
      { id: "americanfootball_nfl", key: "americanfootball_nfl", name: "NFL", group: "American Football" },
    ];
  }

  async getEvents(sportKey) {
    const now = new Date();
    return [
      {
        id: "mock-event-1",
        externalId: "mock-event-1",
        sportKey,
        name: "Team A vs Team B",
        homeTeam: "Team A",
        awayTeam: "Team B",
        startTime: new Date(now.getTime() + 2 * 60 * 60 * 1000),
        status: "scheduled",
      },
      {
        id: "mock-event-2",
        externalId: "mock-event-2",
        sportKey,
        name: "Team C vs Team D",
        homeTeam: "Team C",
        awayTeam: "Team D",
        startTime: new Date(now.getTime() + 4 * 60 * 60 * 1000),
        status: "scheduled",
      },
    ];
  }

  async getOdds(sportKey) {
    const events = await this.getEvents(sportKey);
    return events.map((event) => ({
      ...event,
      bookmaker: "Mock Bookmaker",
      markets: [
        {
          id: `market-${event.id}-h2h`,
          eventId: event.id,
          name: "Match Result",
          type: "1x2",
          externalKey: "h2h",
          status: "open",
          lastUpdate: new Date(),
          selections: [
            { id: `sel-${event.id}-1`, name: event.homeTeam, odds: 1.8 + Math.random() * 0.4, status: "active", sortOrder: 0 },
            { id: `sel-${event.id}-2`, name: "Draw", odds: 3.2 + Math.random() * 0.6, status: "active", sortOrder: 1 },
            { id: `sel-${event.id}-3`, name: event.awayTeam, odds: 2.5 + Math.random() * 0.5, status: "active", sortOrder: 2 },
          ],
        },
        {
          id: `market-${event.id}-ou`,
          eventId: event.id,
          name: "Total",
          type: "over_under",
          externalKey: "totals",
          status: "open",
          lastUpdate: new Date(),
          selections: [
            { id: `sel-${event.id}-over`, name: "Over 2.5", odds: 1.85 + Math.random() * 0.2, point: 2.5, status: "active", sortOrder: 0 },
            { id: `sel-${event.id}-under`, name: "Under 2.5", odds: 1.95 + Math.random() * 0.2, point: 2.5, status: "active", sortOrder: 1 },
          ],
        },
      ],
    }));
  }

  async getEventOdds(sportKey, eventId) {
    const events = await this.getOdds(sportKey);
    return events.find((e) => e.id === eventId) || events[0];
  }

  async subscribe(eventId, callback, sportKey) {
    // Simulate periodic updates
    const subscriptionId = `mock-sub-${Date.now()}`;
    return subscriptionId;
  }

  async unsubscribe(subscriptionId) {
    // No-op for mock
  }

  transformEvent(e) {
    return e;
  }

  transformOdds(o) {
    return o;
  }
}

module.exports = {
  BaseOddsProvider,
  TheOddsApiProvider,
  MockProvider,
  createProvider,
};
