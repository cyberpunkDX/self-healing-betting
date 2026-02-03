"use strict";

const moleculerConfig = require("./moleculer.config");
const redisConfig = require("./redis.config");
const databaseConfig = require("./database.config");

module.exports = {
  moleculer: moleculerConfig,
  redis: redisConfig,
  database: databaseConfig,
};
