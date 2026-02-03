"use strict";

const Joi = require("joi");

/**
 * Common validation schemas for the betting platform
 */

// UUID validation
const uuidSchema = Joi.string().uuid({ version: "uuidv4" });

// Pagination schemas
const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sortBy: Joi.string().default("createdAt"),
  sortOrder: Joi.string().valid("asc", "desc").default("desc"),
});

// User schemas
const userSchemas = {
  register: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).max(128).required(),
    username: Joi.string().alphanum().min(3).max(30).required(),
    firstName: Joi.string().max(50),
    lastName: Joi.string().max(50),
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  }),

  updateProfile: Joi.object({
    firstName: Joi.string().max(50),
    lastName: Joi.string().max(50),
    phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/),
  }),
};

// Bet schemas
const betSchemas = {
  placeBet: Joi.object({
    eventId: uuidSchema.required(),
    marketId: uuidSchema.required(),
    selectionId: uuidSchema.required(),
    odds: Joi.number().positive().precision(2).required(),
    stake: Joi.number().positive().precision(2).min(0.01).max(100000).required(),
    betType: Joi.string().valid("single", "multiple", "system").default("single"),
  }),

  placeBetMultiple: Joi.object({
    bets: Joi.array()
      .items(
        Joi.object({
          eventId: uuidSchema.required(),
          marketId: uuidSchema.required(),
          selectionId: uuidSchema.required(),
          odds: Joi.number().positive().precision(2).required(),
        })
      )
      .min(2)
      .max(20)
      .required(),
    stake: Joi.number().positive().precision(2).min(0.01).max(100000).required(),
    betType: Joi.string().valid("accumulator", "system").required(),
  }),

  cashout: Joi.object({
    betId: uuidSchema.required(),
    amount: Joi.number().positive().precision(2),
  }),
};

// Wallet schemas
const walletSchemas = {
  deposit: Joi.object({
    amount: Joi.number().positive().precision(2).min(1).max(50000).required(),
    paymentMethod: Joi.string().valid("card", "bank", "crypto").required(),
    paymentDetails: Joi.object().required(),
  }),

  withdraw: Joi.object({
    amount: Joi.number().positive().precision(2).min(10).max(50000).required(),
    withdrawalMethod: Joi.string().valid("card", "bank", "crypto").required(),
    withdrawalDetails: Joi.object().required(),
  }),

  transfer: Joi.object({
    toUserId: uuidSchema.required(),
    amount: Joi.number().positive().precision(2).min(1).max(10000).required(),
  }),
};

// Event schemas
const eventSchemas = {
  create: Joi.object({
    name: Joi.string().max(200).required(),
    sportId: uuidSchema.required(),
    leagueId: uuidSchema.required(),
    startTime: Joi.date().iso().greater("now").required(),
    participants: Joi.array()
      .items(
        Joi.object({
          name: Joi.string().max(100).required(),
          type: Joi.string().valid("home", "away", "participant").required(),
        })
      )
      .min(2)
      .required(),
  }),

  updateStatus: Joi.object({
    status: Joi.string()
      .valid("scheduled", "live", "suspended", "finished", "cancelled")
      .required(),
  }),
};

// Odds schemas
const oddsSchemas = {
  update: Joi.object({
    marketId: uuidSchema.required(),
    selections: Joi.array()
      .items(
        Joi.object({
          selectionId: uuidSchema.required(),
          odds: Joi.number().positive().precision(2).min(1.01).max(10000).required(),
          status: Joi.string().valid("active", "suspended").default("active"),
        })
      )
      .min(1)
      .required(),
  }),
};

/**
 * Validate data against a schema
 */
const validate = (schema, data, options = {}) => {
  const defaultOptions = {
    abortEarly: false,
    stripUnknown: true,
    ...options,
  };

  const { error, value } = schema.validate(data, defaultOptions);

  if (error) {
    const errors = error.details.map((detail) => ({
      field: detail.path.join("."),
      message: detail.message,
    }));
    return { valid: false, errors, value: null };
  }

  return { valid: true, errors: null, value };
};

/**
 * Create a Moleculer parameter validator from Joi schema
 */
const toMoleculerParams = (joiSchema) => {
  const description = joiSchema.describe();
  return convertJoiToMoleculer(description);
};

const convertJoiToMoleculer = (description) => {
  if (!description) return {};

  const result = {};

  if (description.keys) {
    for (const [key, value] of Object.entries(description.keys)) {
      result[key] = convertJoiField(value);
    }
  }

  return result;
};

const convertJoiField = (field) => {
  const typeMap = {
    string: "string",
    number: "number",
    boolean: "boolean",
    array: "array",
    object: "object",
    date: "date",
  };

  const type = typeMap[field.type] || "any";
  const optional = !field.flags?.presence || field.flags.presence !== "required";

  return {
    type,
    optional,
  };
};

module.exports = {
  // Schemas
  uuidSchema,
  paginationSchema,
  userSchemas,
  betSchemas,
  walletSchemas,
  eventSchemas,
  oddsSchemas,

  // Utilities
  validate,
  toMoleculerParams,

  // Re-export Joi for custom schemas
  Joi,
};
