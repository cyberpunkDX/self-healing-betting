# Self-Healing Betting Platform

A high-performance, fault-tolerant betting platform built to handle **11.6+ million concurrent open bets** using a microservices architecture with self-healing capabilities.

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **Node.js** | Runtime environment |
| **Moleculer** | Microservices framework |
| **Socket.IO** | Real-time bidirectional communication |
| **Docker** | Containerization |
| **AWS** | Cloud infrastructure & deployment |

## Architecture Overview

```
                                    ┌─────────────────────────────────────────────────────────────┐
                                    │                        AWS Cloud                            │
                                    │  ┌─────────────────────────────────────────────────────┐   │
                                    │  │                   VPC                                │   │
┌──────────┐    ┌──────────────┐   │  │  ┌─────────────┐    ┌─────────────────────────────┐ │   │
│  Users   │───▶│ Route 53     │───┼──┼─▶│   ALB/NLB   │───▶│      EKS / ECS Cluster      │ │   │
│ (11.6M+) │    │ (DNS + Health│   │  │  │ (Load       │    │  ┌─────────────────────────┐ │ │   │
└──────────┘    │  Checks)     │   │  │  │  Balancer)  │    │  │   API Gateway Service   │ │ │   │
                └──────────────┘   │  │  └─────────────┘    │  └───────────┬─────────────┘ │ │   │
                                    │  │                     │              │               │ │   │
                                    │  │                     │  ┌───────────▼─────────────┐ │ │   │
                                    │  │                     │  │   NATS / Redis Streams  │ │ │   │
                                    │  │                     │  │   (Message Transporter) │ │ │   │
                                    │  │                     │  └───────────┬─────────────┘ │ │   │
                                    │  │                     │              │               │ │   │
                                    │  │  ┌──────────────────┴──────────────┴───────────────┴─┴┐  │
                                    │  │  │                  Microservices                     │  │
                                    │  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │  │
                                    │  │  │  │  Bet    │ │  User   │ │  Odds   │ │ Wallet  │  │  │
                                    │  │  │  │ Service │ │ Service │ │ Service │ │ Service │  │  │
                                    │  │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘  │  │
                                    │  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │  │
                                    │  │  │  │ Event   │ │ Settle- │ │ Notifi- │ │ Health  │  │  │
                                    │  │  │  │ Service │ │  ment   │ │ cation  │ │ Monitor │  │  │
                                    │  │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘  │  │
                                    │  │  └────────────────────────────────────────────────────┘  │
                                    │  │                                                          │
                                    │  │  ┌─────────────────────┐  ┌─────────────────────────┐   │
                                    │  │  │  ElastiCache Redis  │  │  Aurora PostgreSQL /    │   │
                                    │  │  │  (Caching + Pub/Sub)│  │  DynamoDB (Persistence) │   │
                                    │  │  └─────────────────────┘  └─────────────────────────┘   │
                                    │  └─────────────────────────────────────────────────────────┘│
                                    └─────────────────────────────────────────────────────────────┘
```

## Microservices

| Service | Responsibility |
|---------|----------------|
| **api-gateway** | Request routing, authentication, rate limiting, WebSocket handling |
| **bet-service** | Bet placement, validation, and management |
| **user-service** | User authentication, profiles, and sessions |
| **odds-service** | Real-time odds calculation and distribution |
| **wallet-service** | Balance management, transactions, and ledger |
| **event-service** | Sports events, matches, and market management |
| **settlement-service** | Bet resolution and payout processing |
| **notification-service** | Push notifications, emails, and alerts |
| **health-monitor** | Service health checks and self-healing orchestration |

## Self-Healing Capabilities

The platform implements multiple self-healing mechanisms:

### Service Level
- **Circuit Breakers**: Prevent cascade failures using Moleculer's built-in circuit breaker
- **Automatic Retries**: Configurable retry policies with exponential backoff
- **Bulkhead Pattern**: Isolate failures to prevent system-wide impact
- **Health Checks**: Continuous monitoring with automatic service restart

### Infrastructure Level
- **Auto Scaling**: ECS/EKS auto-scaling based on CPU, memory, and custom metrics
- **Multi-AZ Deployment**: Redundancy across availability zones
- **Database Failover**: Aurora automatic failover with read replicas
- **Queue-Based Load Leveling**: Buffer traffic spikes using message queues

### Application Level
- **Graceful Degradation**: Fallback responses when services are unavailable
- **Request Hedging**: Parallel requests to multiple instances
- **Timeout Management**: Aggressive timeouts to free resources quickly
- **State Recovery**: Persistent state with automatic recovery on restart

## Scaling Strategy for 11.6M+ Open Bets

### Horizontal Scaling
```yaml
# Target metrics for auto-scaling
bet-service:
  min_instances: 20
  max_instances: 200
  target_cpu: 60%
  target_memory: 70%
  scale_up_cooldown: 60s
  scale_down_cooldown: 300s
```

### Data Partitioning
- **Sharding**: Bets sharded by user_id hash across multiple database nodes
- **Hot/Cold Storage**: Active bets in Redis, settled bets in PostgreSQL/DynamoDB
- **Event Sourcing**: Append-only log for bet state changes

### Caching Strategy
```
┌─────────────────────────────────────────────────────────┐
│                    Caching Layers                       │
├─────────────────────────────────────────────────────────┤
│  L1: In-Memory (Node.js)  │  TTL: 1s   │  Hot odds     │
│  L2: Redis Cluster        │  TTL: 10s  │  User sessions│
│  L3: CDN (CloudFront)     │  TTL: 60s  │  Static data  │
└─────────────────────────────────────────────────────────┘
```

### Estimated Resource Requirements

| Component | Specification | Quantity |
|-----------|---------------|----------|
| API Gateway | c6i.2xlarge | 10-50 |
| Bet Service | c6i.4xlarge | 20-200 |
| Redis Cluster | r6g.2xlarge | 6 nodes |
| Aurora PostgreSQL | r6g.4xlarge | 1 writer + 5 readers |
| NATS Cluster | c6i.xlarge | 5 nodes |

## Project Structure

```
self-healing-betting/
├── backend/
│   ├── services/
│   │   ├── api-gateway/
│   │   ├── bet-service/
│   │   ├── user-service/
│   │   ├── odds-service/
│   │   ├── wallet-service/
│   │   ├── event-service/
│   │   ├── settlement-service/
│   │   ├── notification-service/
│   │   └── health-monitor/
│   ├── lib/
│   │   ├── middleware/
│   │   ├── utils/
│   │   └── validators/
│   ├── config/
│   │   ├── moleculer.config.js
│   │   ├── redis.config.js
│   │   └── database.config.js
│   └── package.json
├── infrastructure/
│   ├── docker/
│   │   ├── Dockerfile
│   │   └── docker-compose.yml
│   ├── kubernetes/
│   │   ├── deployments/
│   │   ├── services/
│   │   └── configmaps/
│   └── terraform/
│       ├── modules/
│       ├── environments/
│       └── main.tf
├── docs/
│   ├── api/
│   ├── architecture/
│   └── runbooks/
└── README.md
```

## Getting Started

### Prerequisites

- Node.js >= 20.x
- Docker & Docker Compose
- AWS CLI configured
- kubectl (for Kubernetes deployment)

### Local Development

```bash
# Clone the repository
git clone https://github.com/cyberpunkDX/self-healing-betting.git
cd self-healing-betting

# Install dependencies
cd backend
npm install

# Start infrastructure services
docker-compose up -d redis nats postgres

# Start all microservices in development mode
npm run dev

# Or start individual services
npm run dev:bet-service
npm run dev:odds-service
```

### Environment Variables

```bash
# .env.example
NODE_ENV=development
LOG_LEVEL=info

# Moleculer
TRANSPORTER=nats://localhost:4222
CACHER=redis://localhost:6379

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/betting

# Redis
REDIS_URL=redis://localhost:6379

# AWS (Production)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

### Running Tests

```bash
# Unit tests
npm run test

# Integration tests
npm run test:integration

# Load tests
npm run test:load
```

## Real-Time Communication

Socket.IO is used for real-time features:

```javascript
// Client connection
const socket = io('wss://api.betting-platform.com', {
  transports: ['websocket'],
  auth: { token: 'user-jwt-token' }
});

// Subscribe to odds updates
socket.emit('subscribe:odds', { eventId: '12345' });
socket.on('odds:update', (data) => {
  console.log('New odds:', data);
});

// Subscribe to bet status
socket.emit('subscribe:bet', { betId: 'bet-uuid' });
socket.on('bet:settled', (data) => {
  console.log('Bet settled:', data);
});
```

### Socket.IO Scaling with Redis Adapter

```javascript
// Horizontal scaling with Redis adapter
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();

io.adapter(createAdapter(pubClient, subClient));
```

## Deployment

### Docker Build

```bash
# Build all services
docker-compose build

# Build specific service
docker build -t bet-service:latest -f docker/Dockerfile --target bet-service .
```

### AWS Deployment

```bash
# Initialize Terraform
cd infrastructure/terraform
terraform init

# Plan deployment
terraform plan -var-file=environments/production.tfvars

# Apply infrastructure
terraform apply -var-file=environments/production.tfvars

# Deploy services to ECS/EKS
./scripts/deploy.sh production
```

### Kubernetes Deployment

```bash
# Apply configurations
kubectl apply -f infrastructure/kubernetes/

# Scale services
kubectl scale deployment bet-service --replicas=50

# Check status
kubectl get pods -l app=bet-service
```

## Monitoring & Observability

### Metrics (CloudWatch / Prometheus)
- Request rate, latency, and error rate per service
- Open bets count and placement rate
- WebSocket connection count
- Database connection pool utilization
- Cache hit/miss ratios

### Logging (CloudWatch Logs / ELK)
- Structured JSON logging
- Correlation IDs for request tracing
- Log levels: error, warn, info, debug

### Tracing (AWS X-Ray / Jaeger)
- Distributed tracing across services
- Latency breakdown per service
- Dependency mapping

### Alerting
- Service health degradation
- Error rate thresholds
- Scaling events
- Database performance

## Performance Benchmarks

| Metric | Target | Achieved |
|--------|--------|----------|
| Bet placement latency (p99) | < 100ms | TBD |
| Odds update latency | < 50ms | TBD |
| Concurrent WebSocket connections | 1M+ | TBD |
| Bets processed per second | 50,000+ | TBD |
| System availability | 99.99% | TBD |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support and questions, please open an issue in the GitHub repository.
