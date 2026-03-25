# Fluxora Backend

Express + TypeScript API for the Fluxora treasury streaming protocol. Provides REST endpoints for streams, health checks, and (later) Horizon sync and analytics.

## What's in this repo

- **API Gateway** — REST API for stream CRUD and health
- **Streams API** — List, get, and create stream records (in-memory placeholder; will be replaced by PostgreSQL + Horizon listener)
- Ready to extend with JWT, RBAC, rate limiting, and streaming engine

## Tech stack

- Node.js 18+
- TypeScript
- Express

## Local setup

### Prerequisites

- Node.js 18+
- npm or pnpm

### Install and run

```bash
npm install
npm run dev
```

API runs at [http://localhost:3000](http://localhost:3000).

### Scripts

- `npm run dev` — Run with tsx watch (no build)
- `npm run build` — Compile to `dist/`
- `npm start` — Run compiled `dist/index.js`

## API overview

| Method | Path              | Description        |
|--------|-------------------|--------------------|
| GET    | `/`               | API info           |
| GET    | `/health`         | Health check       |
| GET    | `/api/streams`   | List streams       |
| GET    | `/api/streams/:id` | Get one stream   |
| POST   | `/api/streams`   | Create stream (body: sender, recipient, depositAmount, ratePerSecond, startTime) |

All responses are JSON. Stream data is in-memory until you add PostgreSQL.

## Project structure

```
src/
  routes/     # health, streams
  index.ts    # Express app and server
k6/
  main.js     # k6 entrypoint — composes all scenarios
  config.js   # Thresholds, stage profiles, base URL
  helpers.js  # Shared metrics, check utilities, payload generators
  scenarios/
    health.js          # GET /health
    streams-list.js    # GET /api/streams
    streams-get.js     # GET /api/streams/:id (200 + 404 paths)
    streams-create.js  # POST /api/streams (valid + edge cases)
```

## Load testing (k6)

The `k6/` directory contains a [k6](https://k6.io/) load-testing harness for all critical endpoints.

### Prerequisites

Install k6 ([docs](https://grafana.com/docs/k6/latest/set-up/install-k6/)):

```bash
# macOS
brew install k6

# Windows (winget)
winget install k6 --source winget

# Windows (choco)
choco install k6

# Docker
docker pull grafana/k6
```

### Running

Start the API in one terminal:

```bash
npm run dev
```

Run a load test profile in another:

```bash
# Smoke (default — 5 VUs, 1 min, good for CI)
npm run k6:smoke

# Load (50 VUs, 5 min)
npm run k6:load

# Stress (ramp to 200 VUs)
npm run k6:stress

# Soak (30 VUs, 24 min — memory leak detection)
npm run k6:soak
```

Override the target URL for staging/production:

```bash
k6 run -e PROFILE=load -e K6_BASE_URL=https://staging.fluxora.io k6/main.js
```

### Profiles

| Profile | VUs   | Duration | Purpose                          |
|---------|-------|----------|----------------------------------|
| smoke   | 5     | 1 min    | CI gate / sanity check           |
| load    | 50    | 5 min    | Pre-release regression           |
| stress  | → 200 | 6 min    | Capacity ceiling / breaking point|
| soak    | 30    | 24 min   | Memory leaks / drift detection   |

### SLO thresholds

| Metric                 | Target         |
|------------------------|----------------|
| p(95) response time    | < 500 ms       |
| p(99) response time    | < 1 000 ms     |
| Error rate             | < 1 %          |
| Health p(99) latency   | < 200 ms       |

If any threshold is breached, k6 exits with a non-zero code — suitable for CI gates.

### Scenarios covered

- **health** — `GET /health` readiness probe; must never fail.
- **streams_list** — `GET /api/streams`; validates JSON array response.
- **streams_get** — `GET /api/streams/:id`; exercises both 200 (existing) and 404 (missing) paths.
- **streams_create** — `POST /api/streams`; valid payloads (201) and empty-body edge case.

### Trust boundaries modelled

| Boundary           | Endpoints                            | Notes |
|--------------------|--------------------------------------|-------|
| Public internet    | GET /health, GET /api/streams[/:id]  | Read-only, unauthenticated |
| Partner (future)   | POST /api/streams                    | Auth not yet enforced — tracked as follow-up |

### Failure modes tested

| Mode                    | Expected client behavior           | Covered by        |
|-------------------------|------------------------------------|--------------------|
| Missing stream ID       | 404 `{ error: "Stream not found" }`| streams-get        |
| Empty POST body         | Service defaults fields (201)      | streams-create     |
| Latency degradation     | Thresholds catch p95/p99 drift     | All scenarios      |

### Intentional non-goals (follow-up)

- **Auth header injection**: No JWT layer yet; will add when auth middleware lands.
- **Database failure injection**: In-memory store only; re-run after PostgreSQL migration.
- **Stellar RPC dependency simulation**: Requires contract integration work.
- **Rate-limiting verification**: Rate limiter not yet implemented.

### Observability / incident diagnosis

Operators can diagnose load-test runs via:

1. **k6 terminal summary** — real-time VU count, latency percentiles, error rate.
2. **k6 JSON output** — `k6 run --out json=results.json k6/main.js` for post-hoc analysis.
3. **Grafana Cloud k6** — `k6 cloud k6/main.js` streams results to a dashboard (requires account).

## Environment

Optional:

- `PORT` — Server port (default: 3000)

Later you can add `DATABASE_URL`, `REDIS_URL`, `HORIZON_URL`, `JWT_SECRET`, etc.

## Related repos

- **fluxora-frontend** — Dashboard and recipient UI
- **fluxora-contracts** — Soroban smart contracts

Each is a separate Git repository.
