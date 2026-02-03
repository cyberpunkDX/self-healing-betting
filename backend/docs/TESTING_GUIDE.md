# Testing Guide

This guide covers how to test the Self-Healing Betting Platform locally.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Testing with REPL](#testing-with-repl)
- [Testing with HTTP API](#testing-with-http-api)
- [End-to-End Testing Flow](#end-to-end-testing-flow)
- [Service-Specific Testing](#service-specific-testing)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

- **Node.js** >= 20.x
- **Docker** & Docker Compose
- **curl** or HTTP client (Postman, Insomnia)

### Installation

```bash
# Clone and install
cd backend
npm install

# Create environment file
cp .env.example .env
```

---

## Quick Start

### 1. Start Infrastructure

```bash
# Start PostgreSQL, Redis, and NATS
npm run docker:infra

# Verify containers are running
docker ps
```

Expected output:
```
CONTAINER ID   IMAGE              STATUS         PORTS
xxxx           postgres:16        Up             0.0.0.0:5432->5432/tcp
xxxx           redis:7            Up             0.0.0.0:6379->6379/tcp
xxxx           nats:2.10          Up             0.0.0.0:4222->4222/tcp
```

### 2. Choose Testing Method

| Method | Command | Best For |
|--------|---------|----------|
| REPL | `npm run repl` | Quick testing, debugging |
| HTTP API | `npm run dev` | Integration testing, frontend dev |
| Single Service | `npm run dev:user-service` | Isolated testing |

---

## Testing with REPL

The REPL provides an interactive shell for testing services directly.

### Start REPL

```bash
npm run repl
```

### Built-in Commands

| Command | Description |
|---------|-------------|
| `test-user` | Create a test user with wallet |
| `test-deposit <userId> <amount>` | Deposit funds to wallet |
| `test-bet <userId> <stake>` | Place a bet on first available event |
| `list-events` | List upcoming events |
| `list-sports` | List available sports |
| `open-bets <userId>` | Show user's open bets |
| `health` | Check system health |
| `services` | List all services |

### Moleculer Commands

| Command | Description |
|---------|-------------|
| `call <action> [params]` | Call a service action |
| `dcall <action> [params]` | Call with debug output |
| `emit <event> [payload]` | Emit an event |
| `actions` | List all available actions |
| `nodes` | List connected nodes |
| `exit` | Exit REPL |

### Example REPL Session

```bash
$ npm run repl

mol $ test-user
# Output: { user: { id: "abc-123", email: "test@example.com" }, accessToken: "..." }

mol $ test-deposit abc-123 100
# Output: { success: true, newBalance: 100 }

mol $ call wallet.balance --#userId abc-123
# Output: { balance: 100, lockedBalance: 0, availableBalance: 100 }

mol $ list-events
# Output: [{ id: "...", name: "Manchester United vs Liverpool", ... }]

mol $ test-bet abc-123 10
# Output: { betId: "...", status: "open", potentialWin: 20 }

mol $ open-bets abc-123
# Output: [{ id: "...", stake: 10, status: "open" }]
```

### Direct Service Calls

```bash
# Call with parameters
mol $ call user.register --email john@test.com --password secret123 --username john

# Call with meta (for authenticated requests)
mol $ call wallet.balance --#userId abc-123

# Call with JSON params
mol $ call bet.place --eventId "..." --marketId "..." --selectionId "..." --odds 2.5 --stake 10 --#userId abc-123
```

---

## Testing with HTTP API

### Start All Services

```bash
npm run dev
```

The API Gateway will be available at `http://localhost:3000`.

### API Endpoints

#### Health Checks

```bash
# Basic health
curl http://localhost:3000/health

# Readiness (checks all services)
curl http://localhost:3000/health/ready

# Liveness
curl http://localhost:3000/health/live
```

#### Authentication

```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "username": "testuser"
  }'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'

# Response includes accessToken - save it!
# export TOKEN="your-access-token"
```

#### User Profile (Protected)

```bash
# Get profile
curl http://localhost:3000/api/user/me \
  -H "Authorization: Bearer $TOKEN"

# Update profile
curl -X PATCH http://localhost:3000/api/user/profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"firstName": "John", "lastName": "Doe"}'
```

#### Wallet (Protected)

```bash
# Get balance
curl http://localhost:3000/api/wallet/balance \
  -H "Authorization: Bearer $TOKEN"

# Deposit
curl -X POST http://localhost:3000/api/wallet/deposit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100, "paymentMethod": "card"}'

# Get transactions
curl http://localhost:3000/api/wallet/transactions \
  -H "Authorization: Bearer $TOKEN"
```

#### Events (Public)

```bash
# List sports
curl http://localhost:3000/api/events/sports

# List upcoming events
curl http://localhost:3000/api/events/upcoming

# List live events
curl http://localhost:3000/api/events/live

# Get event with markets
curl http://localhost:3000/api/events/{eventId}

# Search events
curl "http://localhost:3000/api/events/search?query=manchester"
```

#### Odds (Public)

```bash
# Get provider status
curl http://localhost:3000/api/odds/provider/status

# Get available sports
curl http://localhost:3000/api/odds/sports

# Get odds for event
curl http://localhost:3000/api/odds/event/{eventId}

# Get selection odds
curl http://localhost:3000/api/odds/selection/{selectionId}
```

#### Betting (Protected)

```bash
# Place single bet
curl -X POST http://localhost:3000/api/bet/place \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "event-uuid",
    "marketId": "market-uuid",
    "selectionId": "selection-uuid",
    "odds": 2.50,
    "stake": 10
  }'

# Place accumulator
curl -X POST http://localhost:3000/api/bet/place/accumulator \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "selections": [
      {"eventId": "...", "marketId": "...", "selectionId": "...", "odds": 2.0},
      {"eventId": "...", "marketId": "...", "selectionId": "...", "odds": 1.5}
    ],
    "stake": 10
  }'

# Get bet history
curl http://localhost:3000/api/bet/history \
  -H "Authorization: Bearer $TOKEN"

# Get open bets
curl http://localhost:3000/api/bet/open \
  -H "Authorization: Bearer $TOKEN"

# Get cashout value
curl http://localhost:3000/api/bet/{betId}/cashout-value \
  -H "Authorization: Bearer $TOKEN"

# Cash out bet
curl -X POST http://localhost:3000/api/bet/{betId}/cashout \
  -H "Authorization: Bearer $TOKEN"
```

#### Notifications (Protected)

```bash
# List notifications
curl http://localhost:3000/api/notifications \
  -H "Authorization: Bearer $TOKEN"

# Get unread count
curl http://localhost:3000/api/notifications/unread/count \
  -H "Authorization: Bearer $TOKEN"

# Mark as read
curl -X POST http://localhost:3000/api/notifications/{id}/read \
  -H "Authorization: Bearer $TOKEN"

# Mark all as read
curl -X POST http://localhost:3000/api/notifications/read-all \
  -H "Authorization: Bearer $TOKEN"
```

---

## End-to-End Testing Flow

### Complete User Journey

```bash
# 1. Register user
REGISTER_RESPONSE=$(curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "bettor@test.com", "password": "password123", "username": "bettor"}')

TOKEN=$(echo $REGISTER_RESPONSE | jq -r '.accessToken')
USER_ID=$(echo $REGISTER_RESPONSE | jq -r '.user.id')

echo "User ID: $USER_ID"
echo "Token: $TOKEN"

# 2. Deposit funds
curl -X POST http://localhost:3000/api/wallet/deposit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 500, "paymentMethod": "card"}'

# 3. Check balance
curl http://localhost:3000/api/wallet/balance \
  -H "Authorization: Bearer $TOKEN"

# 4. Browse events
EVENTS=$(curl -s http://localhost:3000/api/events/upcoming)
EVENT_ID=$(echo $EVENTS | jq -r '.items[0].id')
MARKET_ID=$(echo $EVENTS | jq -r '.items[0].markets[0].id')
SELECTION_ID=$(echo $EVENTS | jq -r '.items[0].markets[0].selections[0].id')
ODDS=$(echo $EVENTS | jq -r '.items[0].markets[0].selections[0].odds')

echo "Event: $EVENT_ID"
echo "Market: $MARKET_ID"
echo "Selection: $SELECTION_ID"
echo "Odds: $ODDS"

# 5. Place bet
curl -X POST http://localhost:3000/api/bet/place \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"eventId\": \"$EVENT_ID\",
    \"marketId\": \"$MARKET_ID\",
    \"selectionId\": \"$SELECTION_ID\",
    \"odds\": $ODDS,
    \"stake\": 25
  }"

# 6. Check open bets
curl http://localhost:3000/api/bet/open \
  -H "Authorization: Bearer $TOKEN"

# 7. Check notifications
curl http://localhost:3000/api/notifications \
  -H "Authorization: Bearer $TOKEN"

# 8. Check updated balance
curl http://localhost:3000/api/wallet/balance \
  -H "Authorization: Bearer $TOKEN"
```

---

## Service-Specific Testing

### Health Monitor

```bash
# In REPL
mol $ call health-monitor.status
mol $ call health-monitor.services
mol $ call health-monitor.nodes
mol $ call health-monitor.circuitBreakers
mol $ call health-monitor.check
```

### Odds Service

```bash
# Check provider status
mol $ call odds.providerStatus

# Force sync from provider
mol $ call odds.sync

# Validate odds for bet
mol $ call odds.validate --selectionId "..." --expectedOdds 2.5 --tolerance 0.05

# Calculate accumulator
mol $ call odds.calculateAccumulator --selectionIds '["sel1", "sel2", "sel3"]'
```

### Settlement Service (Admin)

```bash
# Settle a market manually
mol $ call settlement.settleMarket --marketId "..." --results '[{"selectionId": "...", "result": "winner"}]'

# Settle entire event
mol $ call settlement.settleEvent --eventId "..." --homeScore 2 --awayScore 1

# Void a market
mol $ call settlement.voidMarket --marketId "..." --reason "Match abandoned"
```

---

## Troubleshooting

### Common Issues

#### Services Not Starting

```bash
# Check if infrastructure is running
docker ps

# Check logs
npm run docker:logs

# Restart infrastructure
npm run docker:infra:stop
npm run docker:infra
```

#### Connection Refused

```bash
# Verify ports
netstat -an | grep -E "(3000|5432|6379|4222)"

# Check .env configuration
cat .env | grep -E "(PORT|HOST|URL)"
```

#### Odds Provider Errors

If you see "The Odds API key is required":
- The mock provider is used automatically in development
- Set `ODDS_API_KEY` in `.env` for real odds

```bash
# Check provider status
mol $ call odds.providerStatus
```

#### Authentication Failures

```bash
# Verify token
mol $ call user.verifyToken --token "your-token"

# Check user exists
mol $ call user.get --id "user-id"
```

### Debug Mode

```bash
# Run with debug logging
LOG_LEVEL=debug npm run repl

# In REPL, use dcall for debug output
mol $ dcall user.login --email test@test.com --password password123
```

### Reset Data

Since we're using in-memory storage, restart services to reset:

```bash
# Restart REPL
# Press Ctrl+C, then:
npm run repl

# Or restart all services
# Press Ctrl+C, then:
npm run dev
```

---

## Development Tools

### Admin UIs (via Docker)

When using `npm run docker:dev`:

| Tool | URL | Credentials |
|------|-----|-------------|
| pgAdmin | http://localhost:8082 | admin@betting.local / admin |
| Redis Commander | http://localhost:8081 | - |
| NATS Monitoring | http://localhost:8222 | - |

### Useful Docker Commands

```bash
# View logs
docker logs betting-postgres
docker logs betting-redis
docker logs betting-nats

# Connect to PostgreSQL
docker exec -it betting-postgres psql -U postgres -d betting

# Connect to Redis
docker exec -it betting-redis redis-cli

# Check NATS
curl http://localhost:8222/varz
```

---

## Next Steps

1. **Add Real Odds API Key**: Get a free key from [The Odds API](https://the-odds-api.com/)
2. **Run Load Tests**: Use tools like k6 or Artillery
3. **Add Unit Tests**: `npm test`
4. **Enable Persistent Storage**: Connect to real PostgreSQL/Redis

---

## Quick Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | development | Environment mode |
| `API_PORT` | 3000 | API Gateway port |
| `ODDS_API_KEY` | - | The Odds API key |
| `JWT_SECRET` | change-me | JWT signing secret |
| `LOG_LEVEL` | info | Logging level |

### Service Ports

| Service | Default Port |
|---------|--------------|
| API Gateway | 3000 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| NATS | 4222 |
| NATS Monitor | 8222 |
