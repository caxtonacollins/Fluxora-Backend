/**
 * WebSocket Hub — stream update broadcast channel (#49).
 *
 * Responsibilities:
 * - Track connected clients per stream subscription.
 * - Rate-limit incoming messages per connection.
 * - Reject oversized inbound payloads.
 * - Deduplicate outbound events by (streamId, eventId) to prevent
 * duplicate delivery on reconnect or RPC retry.
 * - Broadcast stream update events to all subscribed clients.
 * - Track per-connection metrics and emit structured lifecycle logs.
 *
 * Protocol (JSON over WebSocket):
 * Client → Server:  { type: "subscribe",   streamId: string }
 * Client → Server:  { type: "unsubscribe", streamId: string }
 * Server → Client:  { type: "stream_update", streamId: string, eventId: string, payload: unknown }
 * Server → Client:  { type: "error", code: string, message: string }
 */

import { WebSocket, WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import type { IncomingMessage, Server } from 'http';

// ── Constants ─────────────────────────────────────────────────────────────────

export const MAX_MESSAGE_BYTES = 4_096;
export const RATE_LIMIT_MAX = 30;
export const RATE_LIMIT_WINDOW_MS = 10_000;
const DEDUP_CACHE_MAX = 10_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StreamUpdateEvent {
  streamId: string;
  eventId: string;
  payload: unknown;
}

interface ConnectionMetrics {
  messagesReceived: number;
  messagesSent: number;
  bytesReceived: number;
  bytesSent: number;
}

interface ClientState {
  id: string;
  connectedAt: number;
  ip: string;
  metrics: ConnectionMetrics;
  subscriptions: Set<string>;
  messageTimestamps: number[];
}

// ── Dedup cache ───────────────────────────────────────────────────────────────

class DedupCache {
  private readonly seen = new Map<string, true>();

  has(streamId: string, eventId: string): boolean {
    return this.seen.has(`${streamId}:${eventId}`);
  }

  add(streamId: string, eventId: string): void {
    const key = `${streamId}:${eventId}`;
    if (this.seen.has(key)) return;
    if (this.seen.size >= DEDUP_CACHE_MAX) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.set(key, true);
  }

  clear(): void {
    this.seen.clear();
  }
}

// ── Hub ───────────────────────────────────────────────────────────────────────

export class StreamHub {
  private readonly wss: WebSocketServer;
  private readonly clients = new Map<WebSocket, ClientState>();
  private readonly subscriptions = new Map<string, Set<WebSocket>>();
  private readonly dedup = new DedupCache();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws/streams' });
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.onConnect(ws, req);
    });
  }

  // ── Connection lifecycle ───────────────────────────────────────────────────

  private onConnect(ws: WebSocket, req: IncomingMessage): void {
    const connectionId = randomUUID();
    const ip = req.socket.remoteAddress || 'unknown';
    const connectedAt = Date.now();

    this.clients.set(ws, {
      id: connectionId,
      connectedAt,
      ip,
      metrics: { messagesReceived: 0, messagesSent: 0, bytesReceived: 0, bytesSent: 0 },
      subscriptions: new Set(),
      messageTimestamps: [],
    });

    console.info(
      JSON.stringify({
        event: 'ws_connect',
        connectionId,
        ip,
        timestamp: new Date(connectedAt).toISOString(),
      }),
    );

    ws.on('message', (data, isBinary) => {
      const state = this.clients.get(ws);

      if (isBinary) {
        this.sendError(ws, 'BINARY_NOT_SUPPORTED', 'Binary frames are not accepted');
        return;
      }

      const raw = data.toString('utf8');
      const byteLength = Buffer.byteLength(raw, 'utf8');

      if (state) {
        state.metrics.messagesReceived += 1;
        state.metrics.bytesReceived += byteLength;
      }

      if (byteLength > MAX_MESSAGE_BYTES) {
        this.sendError(ws, 'PAYLOAD_TOO_LARGE', `Message exceeds ${MAX_MESSAGE_BYTES} bytes`);
        return;
      }

      if (!this.checkRateLimit(ws)) {
        this.sendError(ws, 'RATE_LIMIT_EXCEEDED', 'Too many messages; slow down');
        return;
      }

      this.handleMessage(ws, raw);
    });

    ws.on('close', (code, reason) => this.onDisconnect(ws, code, reason));
    ws.on('error', () => ws.close(1011, 'Internal Error'));
  }

  private onDisconnect(ws: WebSocket, code: number, reason: Buffer): void {
    const state = this.clients.get(ws);
    if (!state) return;

    for (const streamId of state.subscriptions) {
      this.subscriptions.get(streamId)?.delete(ws);
      if (this.subscriptions.get(streamId)?.size === 0) {
        this.subscriptions.delete(streamId);
      }
    }

    const durationMs = Date.now() - state.connectedAt;
    console.info(
      JSON.stringify({
        event: 'ws_disconnect',
        connectionId: state.id,
        durationMs,
        code,
        reason: reason.toString('utf8'),
        metrics: state.metrics,
      }),
    );

    this.clients.delete(ws);
  }

  // ── Network Transmission ───────────────────────────────────────────────────

  private sendMessage(ws: WebSocket, message: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      const state = this.clients.get(ws);
      if (state) {
        state.metrics.messagesSent += 1;
        state.metrics.bytesSent += Buffer.byteLength(message, 'utf8');
      }
    }
  }

  // ── Rate limiting ──────────────────────────────────────────────────────────

  private checkRateLimit(ws: WebSocket): boolean {
    const state = this.clients.get(ws);
    if (!state) return false;

    const now = Date.now();
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    state.messageTimestamps = state.messageTimestamps.filter((t) => t >= cutoff);

    if (state.messageTimestamps.length >= RATE_LIMIT_MAX) {
      return false;
    }

    state.messageTimestamps.push(now);
    return true;
  }

  // ── Message handling ───────────────────────────────────────────────────────

  private handleMessage(ws: WebSocket, raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.sendError(ws, 'INVALID_JSON', 'Message is not valid JSON');
      return;
    }

    if (typeof msg !== 'object' || msg === null) {
      this.sendError(ws, 'INVALID_MESSAGE', 'Message must be a JSON object');
      return;
    }

    const { type, streamId } = msg as Record<string, unknown>;

    if (typeof streamId !== 'string' || streamId.trim() === '') {
      this.sendError(ws, 'INVALID_MESSAGE', 'streamId must be a non-empty string');
      return;
    }

    if (type === 'subscribe') {
      this.subscribe(ws, streamId);
    } else if (type === 'unsubscribe') {
      this.unsubscribe(ws, streamId);
    } else {
      this.sendError(ws, 'UNKNOWN_TYPE', `Unknown message type: ${String(type)}`);
    }
  }

  private subscribe(ws: WebSocket, streamId: string): void {
    const state = this.clients.get(ws);
    if (!state) return;

    state.subscriptions.add(streamId);

    if (!this.subscriptions.has(streamId)) {
      this.subscriptions.set(streamId, new Set());
    }
    this.subscriptions.get(streamId)!.add(ws);
  }

  private unsubscribe(ws: WebSocket, streamId: string): void {
    const state = this.clients.get(ws);
    if (!state) return;

    state.subscriptions.delete(streamId);
    this.subscriptions.get(streamId)?.delete(ws);
    if (this.subscriptions.get(streamId)?.size === 0) {
      this.subscriptions.delete(streamId);
    }
  }

  // ── Broadcast ──────────────────────────────────────────────────────────────

  broadcast(event: StreamUpdateEvent): void {
    const { streamId, eventId, payload } = event;

    if (this.dedup.has(streamId, eventId)) {
      return;
    }
    this.dedup.add(streamId, eventId);

    const subscribers = this.subscriptions.get(streamId);
    if (!subscribers || subscribers.size === 0) return;

    const message = JSON.stringify({ type: 'stream_update', streamId, eventId, payload });

    for (const ws of subscribers) {
      this.sendMessage(ws, message);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private sendError(ws: WebSocket, code: string, message: string): void {
    this.sendMessage(ws, JSON.stringify({ type: 'error', code, message }));
  }

  get clientCount(): number {
    return this.clients.size;
  }

  close(cb?: () => void): void {
    this.wss.close(cb);
  }

  _resetDedup(): void {
    this.dedup.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _hub: StreamHub | null = null;

export function createStreamHub(server: Server): StreamHub {
  _hub = new StreamHub(server);
  return _hub;
}

export function getStreamHub(): StreamHub | null {
  return _hub;
}

export function resetStreamHub(): void {
  _hub = null;
}
