# Fluxora Backend

Express + TypeScript API for the Fluxora treasury streaming protocol. The backend is the off-chain companion to the streaming contract and should present operator-grade HTTP behavior: predictable status codes, explicit failure semantics, durable chain-derived views where required, and enough health detail for staging to be evaluated against production expectations.

## Staging deployment checklist parity with prod

This repository now exposes a concrete staging/prod parity surface:

- `GET /health` provides a public summary suitable for basic probes.
- `GET /health/ready` is the machine-readable readiness gate for automation.
- `GET /health/live` is an administrator-only detailed health report.
- `GET /health/deployment` is an administrator-only staging/prod checklist parity report.

The deployment report records service-level outcomes, trust boundaries, failure modes, observability signals, and explicit non-goals in one place so operators do not need tribal knowledge to understand how the service should behave.

## Service-level outcomes

- HTTP failures use a normalized JSON envelope with `error.code`, `error.status`, and `error.requestId`.
- Amounts crossing the chain/API boundary remain decimal strings such as `depositAmount` and `ratePerSecond`.
- Staging and production readiness fail closed when dependency health or chain-derived freshness does not meet the declared guarantees.
- Duplicate partner delivery is classified explicitly through `Idempotency-Key` reuse with `409 duplicate_delivery`.

## Trust boundaries

| Actor | May do | May not do |
| --- | --- | --- |
| Public internet clients | Read `/`, `/health`, `/health/ready`, `/api/streams`, and `/api/streams/:id` | Access admin diagnostics or protected mutating routes |
| Authenticated partners | Create and cancel streams when bearer auth is configured | Bypass validation or idempotency checks |
| Administrators | Read `/health/live` and `/health/deployment` for incident diagnosis | Override client-visible readiness behavior |
| Internal workers | Advance chain-derived checkpoints and affect readiness via health | Expose unauthenticated HTTP behavior directly |

## Failure modes

| Scenario | Client-visible behavior | Operator expectation |
| --- | --- | --- |
| Invalid input | `400 validation_error` with field details when available | Use request/correlation IDs to trace the rejection |
| Dependency outage | `/health/ready` returns `503 not_ready` | Inspect dependency status in `/health/live` |
| Partial chain-derived data | `/health/ready` returns `503` when indexer freshness is required and unhealthy | Confirm last successful sync time and stall threshold |
| Duplicate delivery | `409 duplicate_delivery` when an `Idempotency-Key` is reused | Correlate retry attempts before replaying |

## Decimal string serialization policy

All amounts crossing the chain/API boundary are serialized as decimal strings to prevent precision loss in JSON.

- `depositAmount` and `ratePerSecond` must be strings such as `"1000000.0000000"` or `"0.0000116"`.
- Native JSON numbers are rejected for those fields.
- Malformed or missing amount fields are classified as `validation_error` with field-specific details.

## API overview

| Method | Path | Description |
| --- | --- | --- |
| GET | `/` | API metadata and route overview |
| GET | `/health` | Public health summary |
| GET | `/health/ready` | Public readiness gate |
| GET | `/health/live` | Admin-only detailed health |
| GET | `/health/deployment` | Admin-only staging/prod parity report |
| GET | `/api/streams` | List streams |
| GET | `/api/streams/:id` | Get a stream by ID |
| POST | `/api/streams` | Create a stream; may require partner bearer auth |
| DELETE | `/api/streams/:id` | Cancel a stream; may require partner bearer auth |

## Verification evidence

Commands used for this change:

```bash
pnpm test
pnpm build
```

Automated coverage for this area now includes:

- normalized 404, invalid JSON, oversized payload, validation, and 500 envelopes
- readiness behavior during dependency outage
- staging deployment parity failure and success cases
- partner/admin auth boundary checks
- duplicate-delivery handling with `Idempotency-Key`

## Non-goals and follow-up work

Intentionally deferred in this issue:

- persistent stream storage
- automatic remediation for unhealthy dependencies
- richer partner/admin identity systems beyond bearer-token gates
- OpenAPI generation for the new health/deployment response schemas

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

- `npm run dev` - run with tsx watch
- `npm run build` - compile to `dist/`
- `npm test` - run the automated test suite
- `npm start` - run compiled `dist/index.js`

## Project structure

```text
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

- `PORT` - server port, default `3000`

Likely future additions:

- `DATABASE_URL`
- `REDIS_URL`
- `HORIZON_URL`
- `JWT_SECRET`

## Related repos

- `fluxora-frontend` - dashboard and recipient UI
- `fluxora-contracts` - Soroban smart contracts
