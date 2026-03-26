# Fluxora Backend

Express + TypeScript API for the Fluxora treasury streaming protocol. Provides REST endpoints for streams, health checks, and (later) Horizon sync and analytics.

## Decimal String Serialization Policy

All amounts crossing the chain/API boundary are serialized as **decimal strings** to prevent precision loss in JSON.

### Amount Fields

- `depositAmount` - Total deposit as decimal string (e.g., "1000000.0000000")
- `ratePerSecond` - Streaming rate as decimal string (e.g., "0.0000116")

### Validation Rules

- Amounts MUST be strings in decimal notation (e.g., "100", "-50", "0.0000001")
- Native JSON numbers are rejected to prevent floating-point precision issues
- Values exceeding safe integer ranges are rejected with `DECIMAL_OUT_OF_RANGE` error

### Error Codes

| Code                     | Description                               |
| ------------------------ | ----------------------------------------- |
| `DECIMAL_INVALID_TYPE`   | Amount was not a string                   |
| `DECIMAL_INVALID_FORMAT` | String did not match decimal pattern      |
| `DECIMAL_OUT_OF_RANGE`   | Value exceeds maximum supported precision |
| `DECIMAL_EMPTY_VALUE`    | Amount was empty or null                  |

### Trust Boundaries

| Actor                  | Capabilities                               |
| ---------------------- | ------------------------------------------ |
| Public Clients         | Read streams, submit valid decimal strings |
| Authenticated Partners | Create streams with validated amounts      |
| Administrators         | Full access, diagnostic logging            |
| Internal Workers       | Database operations, chain interactions    |

### Failure Modes

| Scenario                 | Behavior                          |
| ------------------------ | --------------------------------- |
| Invalid decimal type     | 400 with `DECIMAL_INVALID_TYPE`   |
| Malformed decimal string | 400 with `DECIMAL_INVALID_FORMAT` |
| Precision overflow       | 400 with `DECIMAL_OUT_OF_RANGE`   |
| Missing required field   | 400 with `VALIDATION_ERROR`       |
| Stream not found         | 404 with `NOT_FOUND`              |

### Operational Notes

#### Diagnostic Logging

Serialization events are logged with context for debugging:

```
Decimal validation failed {"field":"depositAmount","errorCode":"DECIMAL_INVALID_TYPE","requestId":"..."}
```

#### Health Observability

- `GET /health` - Returns service health status
- Request IDs enable correlation across logs
- Structured JSON logs for log aggregation systems

### `/api/streams` Cursor Pagination Contract

`GET /api/streams` now uses opaque forward-only cursors returned as `next_cursor`. Clients must treat the cursor as an opaque token, not a stream ID or sortable value. Pages are ordered by ascending `id`, return at most `limit` items, and include `total` for the current list view.

Service outcomes for this endpoint:

- A successful page is read from the current in-process stream view and never duplicates an item within that page.
- Reusing a valid cursor is safe and resumes strictly after the encoded sort key.
- If the last-seen stream is deleted between requests, the cursor still resumes after that key instead of failing stale.
- If the listing dependency is unavailable, the service returns `503 SERVICE_UNAVAILABLE` with a request ID for tracing.

Trust boundaries for this area:

- Public clients may read paginated stream listings only.
- Authenticated partners consume the same read contract and must not infer internal state from cursors.
- Administrators diagnose failures through structured logs, request IDs, and `/health`; they do not receive privileged response bodies from this endpoint.
- Internal workers may refresh the backing view, but duplicate deliveries are absorbed by deterministic ordering plus opaque cursor progression.

Failure modes and client-visible behavior:

- Invalid `limit` or malformed `cursor`: `400 VALIDATION_ERROR`
- Missing stream on `GET /api/streams/:id`: `404 NOT_FOUND`
- Conflicting cancellation on `DELETE /api/streams/:id`: `409 CONFLICT`
- Listing dependency degraded or unavailable: `503 SERVICE_UNAVAILABLE`
- Unexpected process error: `500 INTERNAL_ERROR`

Operator notes:

- Use the response `requestId` to correlate client failures with stream pagination logs.
- `/health` only confirms process liveness today; pagination dependency health is surfaced by request logs and 503 responses.
- Representative regression coverage lives in `tests/streams.test.ts`, including malformed cursor handling, deleted-cursor recovery, and dependency-unavailable behavior.

### `/api/streams` POST Idempotency Contract

`POST /api/streams` now requires an `Idempotency-Key` header for unsafe creation requests. The key is scoped to the normalized request payload: trimmed identities, validated decimal strings, and normalized time fields.

Service outcomes for this endpoint:

- The first successful request for a key creates exactly one stream and returns `201`.
- Retrying the same key with the same normalized payload replays the original `201` response body and sets `Idempotency-Replayed: true`.
- Reusing a key with a different payload returns `409 CONFLICT` and creates no new stream.
- Invalid requests are rejected with `400` and do not reserve the key for future valid retries.
- If the idempotency dependency is degraded, the service returns `503 SERVICE_UNAVAILABLE` rather than risking duplicate side effects.

Trust boundaries for this area:

- Public clients may submit create requests only when they provide a syntactically valid idempotency key.
- Authenticated partners may safely retry after network uncertainty but may not reuse a key for a semantically different operation.
- Administrators diagnose duplicate-delivery reports through request IDs, idempotency keys, and structured logs.
- Internal workers may reconcile downstream effects, but they do not bypass the HTTP idempotency contract.

Failure modes and client-visible behavior:

- Missing or malformed `Idempotency-Key`: `400 VALIDATION_ERROR`
- Invalid stream payload: `400 VALIDATION_ERROR`
- Same key, different payload: `409 CONFLICT`
- Idempotency dependency unavailable: `503 SERVICE_UNAVAILABLE`
- Unexpected process error before a successful write is stored: `500 INTERNAL_ERROR`

Operator notes:

- Correlate retries using the request `requestId`, `Idempotency-Key`, and the `Idempotency-Replayed` response header.
- Representative automated coverage lives in `tests/streams.test.ts` for first-write, replay, conflict, and dependency-unavailable paths.
- The current implementation uses in-memory storage only, so idempotency guarantees last for the life of the process and not across restarts.

Intentional non-goals in this issue:

- Replacing the in-memory store with a durable database view
- Adding authentication or role-based authorization to `/api/streams`
- Exposing page tokens in any format other than the opaque cursor contract
- Providing cross-process or post-restart idempotency durability

#### Verification Commands

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Build TypeScript
npm run build

# Start server
npm start
```

### Known Limitations

- In-memory stream storage (production requires database integration)
- No Stellar RPC integration (placeholder for chain interactions)
- Rate limiting not implemented (future enhancement)

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

| Method | Path               | Description                                                                      |
| ------ | ------------------ | -------------------------------------------------------------------------------- |
| GET    | `/`                | API info                                                                         |
| GET    | `/health`          | Health check                                                                     |
| GET    | `/api/streams`     | List streams                                                                     |
| GET    | `/api/streams/:id` | Get one stream                                                                   |
| POST   | `/api/streams`     | Create stream (body: sender, recipient, depositAmount, ratePerSecond, startTime) |

All responses are JSON. Stream data is in-memory until you add PostgreSQL.

## Project structure

```
src/
  routes/     # health, streams
  index.ts    # Express app and server
```

## Environment

Optional:

- `PORT` — Server port (default: 3000)

Later you can add `DATABASE_URL`, `REDIS_URL`, `HORIZON_URL`, `JWT_SECRET`, etc.

## Related repos

- **fluxora-frontend** — Dashboard and recipient UI
- **fluxora-contracts** — Soroban smart contracts

Each is a separate Git repository.
