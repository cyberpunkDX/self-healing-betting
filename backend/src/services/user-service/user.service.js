"use strict";

const { Service } = require("moleculer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

/**
 * User Service
 * Handles user registration, authentication, and profile management
 */
module.exports = class UserService extends Service {
  constructor(broker) {
    super(broker);

    this.parseServiceSchema({
      name: "user",

      settings: {
        // JWT settings
        jwtSecret: process.env.JWT_SECRET || "change-this-secret-in-production",
        jwtExpiresIn: process.env.JWT_EXPIRES_IN || "24h",
        jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",

        // Password settings
        bcryptRounds: 12,

        // Rate limiting
        maxLoginAttempts: 5,
        lockoutDuration: 15 * 60 * 1000, // 15 minutes
      },

      metadata: {
        description: "User authentication and profile management",
        version: "1.0.0",
      },

      dependencies: [],

      actions: {
        /**
         * Register a new user
         */
        register: {
          rest: "POST /register",
          params: {
            email: { type: "email" },
            password: { type: "string", min: 8, max: 128 },
            username: { type: "string", min: 3, max: 30, pattern: /^[a-zA-Z0-9_]+$/ },
            firstName: { type: "string", max: 50, optional: true },
            lastName: { type: "string", max: 50, optional: true },
          },
          async handler(ctx) {
            const { email, password, username, firstName, lastName } = ctx.params;

            // Check if user already exists
            const existingUser = await this.findUserByEmail(email);
            if (existingUser) {
              throw new this.broker.MoleculerClientError("Email already registered", 409, "EMAIL_EXISTS");
            }

            const existingUsername = await this.findUserByUsername(username);
            if (existingUsername) {
              throw new this.broker.MoleculerClientError("Username already taken", 409, "USERNAME_EXISTS");
            }

            // Hash password
            const passwordHash = await bcrypt.hash(password, this.settings.bcryptRounds);

            // Create user
            const user = {
              id: uuidv4(),
              email: email.toLowerCase(),
              username,
              passwordHash,
              firstName: firstName || null,
              lastName: lastName || null,
              status: "active",
              emailVerified: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            await this.saveUser(user);

            // Create wallet for user
            try {
              await ctx.call("wallet.create", { userId: user.id });
            } catch (error) {
              this.logger.warn("Failed to create wallet for user:", error.message);
            }

            // Generate tokens
            const tokens = this.generateTokens(user);

            this.logger.info(`User registered: ${user.email}`);

            return {
              user: this.sanitizeUser(user),
              ...tokens,
            };
          },
        },

        /**
         * User login
         */
        login: {
          rest: "POST /login",
          params: {
            email: { type: "email" },
            password: { type: "string" },
          },
          async handler(ctx) {
            const { email, password } = ctx.params;

            // Check rate limiting
            const lockout = this.loginAttempts.get(email.toLowerCase());
            if (lockout && lockout.lockedUntil > Date.now()) {
              const remainingTime = Math.ceil((lockout.lockedUntil - Date.now()) / 1000 / 60);
              throw new this.broker.MoleculerClientError(
                `Account temporarily locked. Try again in ${remainingTime} minutes`,
                429,
                "ACCOUNT_LOCKED"
              );
            }

            // Find user
            const user = await this.findUserByEmail(email.toLowerCase());
            if (!user) {
              this.recordFailedLogin(email.toLowerCase());
              throw new this.broker.MoleculerClientError("Invalid credentials", 401, "INVALID_CREDENTIALS");
            }

            // Check password
            const validPassword = await bcrypt.compare(password, user.passwordHash);
            if (!validPassword) {
              this.recordFailedLogin(email.toLowerCase());
              throw new this.broker.MoleculerClientError("Invalid credentials", 401, "INVALID_CREDENTIALS");
            }

            // Check user status
            if (user.status !== "active") {
              throw new this.broker.MoleculerClientError(`Account is ${user.status}`, 403, "ACCOUNT_INACTIVE");
            }

            // Clear login attempts
            this.loginAttempts.delete(email.toLowerCase());

            // Generate tokens
            const tokens = this.generateTokens(user);

            // Store session
            await this.createSession(user.id, tokens.accessToken, ctx.meta);

            this.logger.info(`User logged in: ${user.email}`);

            return {
              user: this.sanitizeUser(user),
              ...tokens,
            };
          },
        },

        /**
         * Refresh access token
         */
        refresh: {
          rest: "POST /refresh",
          params: {
            refreshToken: { type: "string" },
          },
          async handler(ctx) {
            const { refreshToken } = ctx.params;

            try {
              const decoded = jwt.verify(refreshToken, this.settings.jwtSecret);

              if (decoded.type !== "refresh") {
                throw new Error("Invalid token type");
              }

              const user = await this.findUserById(decoded.userId);
              if (!user || user.status !== "active") {
                throw new Error("User not found or inactive");
              }

              const tokens = this.generateTokens(user);

              return {
                user: this.sanitizeUser(user),
                ...tokens,
              };
            } catch (error) {
              throw new this.broker.MoleculerClientError("Invalid refresh token", 401, "INVALID_TOKEN");
            }
          },
        },

        /**
         * Logout user
         */
        logout: {
          rest: "POST /logout",
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (userId) {
              await this.invalidateSession(userId, ctx.meta.token);
            }
            return { success: true };
          },
        },

        /**
         * Get current user profile
         */
        me: {
          rest: "GET /me",
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (!userId) {
              throw new this.broker.MoleculerClientError("Authentication required", 401, "AUTH_REQUIRED");
            }

            const user = await this.findUserById(userId);
            if (!user) {
              throw new this.broker.MoleculerClientError("User not found", 404, "USER_NOT_FOUND");
            }

            return this.sanitizeUser(user);
          },
        },

        /**
         * Update user profile
         */
        updateProfile: {
          rest: "PATCH /profile",
          params: {
            firstName: { type: "string", max: 50, optional: true },
            lastName: { type: "string", max: 50, optional: true },
            phone: { type: "string", pattern: /^\+?[1-9]\d{1,14}$/, optional: true },
          },
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (!userId) {
              throw new this.broker.MoleculerClientError("Authentication required", 401, "AUTH_REQUIRED");
            }

            const user = await this.findUserById(userId);
            if (!user) {
              throw new this.broker.MoleculerClientError("User not found", 404, "USER_NOT_FOUND");
            }

            // Update fields
            const updates = {};
            if (ctx.params.firstName !== undefined) updates.firstName = ctx.params.firstName;
            if (ctx.params.lastName !== undefined) updates.lastName = ctx.params.lastName;
            if (ctx.params.phone !== undefined) updates.phone = ctx.params.phone;

            const updatedUser = { ...user, ...updates, updatedAt: new Date() };
            await this.saveUser(updatedUser);

            return this.sanitizeUser(updatedUser);
          },
        },

        /**
         * Change password
         */
        changePassword: {
          rest: "POST /change-password",
          params: {
            currentPassword: { type: "string" },
            newPassword: { type: "string", min: 8, max: 128 },
          },
          async handler(ctx) {
            const userId = ctx.meta.userId;
            if (!userId) {
              throw new this.broker.MoleculerClientError("Authentication required", 401, "AUTH_REQUIRED");
            }

            const user = await this.findUserById(userId);
            if (!user) {
              throw new this.broker.MoleculerClientError("User not found", 404, "USER_NOT_FOUND");
            }

            // Verify current password
            const validPassword = await bcrypt.compare(ctx.params.currentPassword, user.passwordHash);
            if (!validPassword) {
              throw new this.broker.MoleculerClientError("Current password is incorrect", 400, "INVALID_PASSWORD");
            }

            // Hash new password
            const passwordHash = await bcrypt.hash(ctx.params.newPassword, this.settings.bcryptRounds);

            user.passwordHash = passwordHash;
            user.updatedAt = new Date();
            await this.saveUser(user);

            // Invalidate all sessions
            await this.invalidateAllSessions(userId);

            return { success: true, message: "Password changed successfully" };
          },
        },

        /**
         * Verify JWT token (used by other services)
         */
        verifyToken: {
          params: {
            token: { type: "string" },
          },
          async handler(ctx) {
            try {
              const decoded = jwt.verify(ctx.params.token, this.settings.jwtSecret);

              if (decoded.type !== "access") {
                throw new Error("Invalid token type");
              }

              const user = await this.findUserById(decoded.userId);
              if (!user || user.status !== "active") {
                throw new Error("User not found or inactive");
              }

              return {
                valid: true,
                userId: user.id,
                email: user.email,
                username: user.username,
              };
            } catch (error) {
              return { valid: false, error: error.message };
            }
          },
        },

        /**
         * Get user by ID (internal use)
         */
        get: {
          params: {
            id: { type: "uuid" },
          },
          visibility: "protected",
          async handler(ctx) {
            const user = await this.findUserById(ctx.params.id);
            if (!user) {
              throw new this.broker.MoleculerClientError("User not found", 404, "USER_NOT_FOUND");
            }
            return this.sanitizeUser(user);
          },
        },

        /**
         * Ping for health checks
         */
        ping: {
          async handler() {
            return { status: "ok", service: "user", timestamp: Date.now() };
          },
        },
      },

      methods: {
        /**
         * Generate JWT tokens
         */
        generateTokens(user) {
          const accessToken = jwt.sign(
            {
              userId: user.id,
              email: user.email,
              username: user.username,
              type: "access",
            },
            this.settings.jwtSecret,
            { expiresIn: this.settings.jwtExpiresIn }
          );

          const refreshToken = jwt.sign(
            {
              userId: user.id,
              type: "refresh",
            },
            this.settings.jwtSecret,
            { expiresIn: this.settings.jwtRefreshExpiresIn }
          );

          return { accessToken, refreshToken };
        },

        /**
         * Remove sensitive fields from user object
         */
        sanitizeUser(user) {
          const { passwordHash, ...sanitized } = user;
          return sanitized;
        },

        /**
         * Record failed login attempt
         */
        recordFailedLogin(email) {
          const attempts = this.loginAttempts.get(email) || { count: 0 };
          attempts.count++;
          attempts.lastAttempt = Date.now();

          if (attempts.count >= this.settings.maxLoginAttempts) {
            attempts.lockedUntil = Date.now() + this.settings.lockoutDuration;
            this.logger.warn(`Account locked due to failed login attempts: ${email}`);
          }

          this.loginAttempts.set(email, attempts);
        },

        // In-memory storage (replace with database in production)
        async findUserByEmail(email) {
          return this.users.get(email.toLowerCase());
        },

        async findUserByUsername(username) {
          for (const user of this.users.values()) {
            if (user.username.toLowerCase() === username.toLowerCase()) {
              return user;
            }
          }
          return null;
        },

        async findUserById(id) {
          for (const user of this.users.values()) {
            if (user.id === id) {
              return user;
            }
          }
          return null;
        },

        async saveUser(user) {
          this.users.set(user.email.toLowerCase(), user);
        },

        async createSession(userId, token, meta) {
          const sessions = this.sessions.get(userId) || [];
          sessions.push({
            token: this.hashToken(token),
            createdAt: Date.now(),
            ipAddress: meta.ip,
            userAgent: meta.userAgent,
          });
          this.sessions.set(userId, sessions);
        },

        async invalidateSession(userId, token) {
          const sessions = this.sessions.get(userId) || [];
          const hashedToken = this.hashToken(token);
          const filtered = sessions.filter((s) => s.token !== hashedToken);
          this.sessions.set(userId, filtered);
        },

        async invalidateAllSessions(userId) {
          this.sessions.delete(userId);
        },

        hashToken(token) {
          // Simple hash for session token storage
          return require("crypto").createHash("sha256").update(token).digest("hex").substring(0, 32);
        },
      },

      created() {
        // In-memory stores (replace with Redis/DB in production)
        this.users = new Map();
        this.sessions = new Map();
        this.loginAttempts = new Map();
      },

      async started() {
        this.logger.info("User service started");
      },

      async stopped() {
        this.logger.info("User service stopped");
      },
    });
  }
};
