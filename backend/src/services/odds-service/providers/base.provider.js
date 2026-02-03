"use strict";

/**
 * Base Odds Provider Interface
 * All odds feed providers must implement this interface
 */
class BaseOddsProvider {
  constructor(config = {}) {
    this.config = config;
    this.name = "base";
    this.isConnected = false;
    this.lastSync = null;
  }

  /**
   * Initialize the provider (connect, authenticate, etc.)
   * @returns {Promise<boolean>}
   */
  async initialize() {
    throw new Error("Method 'initialize' must be implemented");
  }

  /**
   * Get list of available sports
   * @returns {Promise<Array<{id: string, name: string, key: string}>>}
   */
  async getSports() {
    throw new Error("Method 'getSports' must be implemented");
  }

  /**
   * Get events for a sport
   * @param {string} sportKey - Sport identifier
   * @param {Object} options - Query options
   * @returns {Promise<Array<Event>>}
   */
  async getEvents(sportKey, options = {}) {
    throw new Error("Method 'getEvents' must be implemented");
  }

  /**
   * Get odds for an event
   * @param {string} sportKey - Sport identifier
   * @param {string} eventId - Event identifier
   * @param {Object} options - Query options (markets, bookmakers)
   * @returns {Promise<EventOdds>}
   */
  async getEventOdds(sportKey, eventId, options = {}) {
    throw new Error("Method 'getEventOdds' must be implemented");
  }

  /**
   * Get odds for multiple events
   * @param {string} sportKey - Sport identifier
   * @param {Object} options - Query options
   * @returns {Promise<Array<EventOdds>>}
   */
  async getOdds(sportKey, options = {}) {
    throw new Error("Method 'getOdds' must be implemented");
  }

  /**
   * Subscribe to live odds updates (if supported)
   * @param {string} eventId - Event identifier
   * @param {Function} callback - Callback for updates
   * @returns {Promise<string>} - Subscription ID
   */
  async subscribe(eventId, callback) {
    throw new Error("Method 'subscribe' must be implemented or provider does not support live updates");
  }

  /**
   * Unsubscribe from live odds updates
   * @param {string} subscriptionId - Subscription identifier
   */
  async unsubscribe(subscriptionId) {
    throw new Error("Method 'unsubscribe' must be implemented");
  }

  /**
   * Get provider status and quota info
   * @returns {Promise<ProviderStatus>}
   */
  async getStatus() {
    return {
      name: this.name,
      isConnected: this.isConnected,
      lastSync: this.lastSync,
      quota: null,
    };
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect() {
    this.isConnected = false;
  }

  /**
   * Transform provider-specific event format to internal format
   * @param {Object} externalEvent - Event from provider
   * @returns {Object} - Internal event format
   */
  transformEvent(externalEvent) {
    throw new Error("Method 'transformEvent' must be implemented");
  }

  /**
   * Transform provider-specific odds format to internal format
   * @param {Object} externalOdds - Odds from provider
   * @returns {Object} - Internal odds format
   */
  transformOdds(externalOdds) {
    throw new Error("Method 'transformOdds' must be implemented");
  }
}

module.exports = BaseOddsProvider;
