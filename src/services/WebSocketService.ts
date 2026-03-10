/**
 * Persistent WebSocket connection to the ClawTalk server.
 *
 * Handles authentication, ping/pong keepalive, exponential backoff reconnect,
 * and typed event dispatch. Singleton per plugin instance.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import type { ResolvedClawTalkConfig } from '../config.js';
import type { Logger } from '../types/plugin.js';
import type {
  WsApprovalResponded,
  WsAuthError,
  WsAuthMessage,
  WsCallEnded,
  WsCallStarted,
  WsContextRequest,
  WsDeepToolRequest,
  WsEvent,
  WsInboundMessage,
  WsOutboundMessage,
  WsSmsReceived,
  WsWalkieRequest,
} from '../types/websocket.js';
import { WebSocketError } from '../utils/errors.js';
import { type EventMap, TypedEmitter } from '../utils/typed-emitter.js';

// ── Constants ───────────────────────────────────────────────

const RECONNECT_MIN_MS = 5000;
const RECONNECT_MAX_MS = 180000; // 3 minutes
const PING_INTERVAL_MS = 30000;
const PONG_TIMEOUT_MS = 10000;
const DUPLICATE_CLIENT_CODE = 4000;

// ── Event Map ───────────────────────────────────────────────

export interface WebSocketEvents extends EventMap {
  context_request: (msg: WsContextRequest) => void;
  'call.started': (msg: WsCallStarted) => void;
  'call.ended': (msg: WsCallEnded) => void;
  deep_tool_request: (msg: WsDeepToolRequest) => void;
  'sms.received': (msg: WsSmsReceived) => void;
  'approval.responded': (msg: WsApprovalResponded) => void;
  walkie_request: (msg: WsWalkieRequest) => void;
  connected: () => void;
  disconnected: (code: number, reason: string) => void;
  error: (err: Error) => void;
}

// ── Read package version ────────────────────────────────────

function readPackageVersion(): string {
  try {
    const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ── Service ─────────────────────────────────────────────────

export class WebSocketService extends TypedEmitter<WebSocketEvents> {
  private readonly config: ResolvedClawTalkConfig;
  private readonly logger: Logger;
  private readonly clientVersion: string;

  private ws: WebSocket | null = null;
  private authenticated = false;
  private isFirstConnect = true;
  private isShuttingDown = false;

  private reconnectAttempts = 0;
  private currentReconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastPingAt: Date | null = null;
  private lastPongAt: Date | null = null;

  constructor(config: ResolvedClawTalkConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.clientVersion = readPackageVersion();
  }

  // ── Public API ──────────────────────────────────────────

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.authenticated;
  }

  get version(): string {
    return this.clientVersion;
  }

  get lastPing(): Date | null {
    return this.lastPingAt;
  }

  get lastPong(): Date | null {
    return this.lastPongAt;
  }

  async connect(): Promise<void> {
    if (this.ws) {
      this.logger.warn?.('WebSocket already exists, disconnecting first');
      this.disconnect();
    }

    this.isShuttingDown = false;
    await this.createConnection();
  }

  disconnect(): void {
    this.isShuttingDown = true;
    this.clearTimers();

    if (this.ws) {
      try {
        this.ws.close(1000, 'Plugin shutdown');
      } catch {
        // Already closed
      }
      this.ws = null;
    }

    this.authenticated = false;
  }

  send(message: WsOutboundMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw WebSocketError.disconnected();
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (err) {
      throw WebSocketError.sendFailed(String(err));
    }
  }

  // ── Connection lifecycle ────────────────────────────────

  private createConnection(): Promise<void> {
    return new Promise<void>((resolvePromise, rejectPromise) => {
      const serverUrl = this.config.server.replace(/^http/, 'ws');
      const wsUrl = `${serverUrl}/ws`;

      this.logger.info(`Connecting to ClawTalk WebSocket (${wsUrl})`);

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (err) {
        rejectPromise(new WebSocketError('WS_CONNECT_FAILED', `Failed to create WebSocket: ${String(err)}`));
        return;
      }

      let settled = false;

      this.ws.on('open', () => {
        this.logger.info('ClawTalk connected, authenticating...');
        this.sendAuth();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        const msg = this.parseMessage(data);
        if (!msg) return;

        if (!this.authenticated) {
          if (msg.type === 'auth_ok') {
            this.handleAuthOk();
            if (!settled) {
              settled = true;
              resolvePromise();
            }
          } else if (msg.type === 'auth_error') {
            const error = WebSocketError.authFailed((msg as WsAuthError).message);
            this.logger.error?.(error.message);
            this.isShuttingDown = true;
            if (!settled) {
              settled = true;
              rejectPromise(error);
            }
          }
          return;
        }

        if (msg.type === 'event') {
          this.dispatchEvent(msg as WsEvent);
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        const reasonStr = reason.toString() || 'unknown';
        this.logger.info(`ClawTalk disconnected: code=${code} reason=${reasonStr}`);

        this.authenticated = false;
        this.clearTimers();

        this.emit('disconnected', code, reasonStr);

        if (!settled) {
          settled = true;
          rejectPromise(new WebSocketError('WS_CLOSED', `Connection closed during auth: ${code}`));
        }

        if (code === DUPLICATE_CLIENT_CODE) {
          this.logger.error?.(WebSocketError.duplicateClient().message);
          this.isShuttingDown = true;
          return;
        }

        if (!this.isShuttingDown) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err: Error) => {
        this.logger.error?.(`ClawTalk WebSocket error: ${err.message}`);

        // If we haven't settled the promise yet (e.g. server returned 502/404
        // before 'open' fires), reject so the caller can handle it gracefully
        // instead of crashing the gateway.
        if (!settled) {
          settled = true;
          rejectPromise(new WebSocketError('WS_CONNECT_FAILED', `Connection error: ${err.message}`));
        }
      });

      this.ws.on('pong', () => {
        this.lastPongAt = new Date();
        this.clearPongTimeout();
      });
    });
  }

  // ── Auth ────────────────────────────────────────────────

  private sendAuth(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const authMsg: WsAuthMessage = {
      type: 'auth',
      api_key: this.config.apiKey,
      client_version: this.clientVersion,
      owner_name: this.config.ownerName !== 'there' ? this.config.ownerName : undefined,
      agent_name: this.config.agentName,
    };

    this.ws.send(JSON.stringify(authMsg));
  }

  private handleAuthOk(): void {
    this.authenticated = true;
    this.reconnectAttempts = 0;
    this.currentReconnectDelay = RECONNECT_MIN_MS;

    this.logger.info(`ClawTalk authenticated (v${this.clientVersion})`);
    this.startPing();

    // Send restart notification on reconnect (not first connect)
    if (!this.isFirstConnect) {
      this.send({
        type: 'client_restart',
        version: this.clientVersion,
        reason: 'reconnect',
      });
      this.logger.info('Sent restart notification to server');
    }

    this.isFirstConnect = false;
    this.emit('connected');
  }

  // ── Ping/Pong ─────────────────────────────────────────

  private startPing(): void {
    this.clearTimers();

    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      this.lastPingAt = new Date();
      this.ws.ping();

      this.pongTimeout = setTimeout(() => {
        this.logger.warn?.('Pong timeout, closing connection');
        this.ws?.terminate();
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  private clearPongTimeout(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private clearTimers(): void {
    this.clearPongTimeout();
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ── Reconnect ─────────────────────────────────────────

  private scheduleReconnect(): void {
    // Prevent double-schedule (both 'error' reject + 'close' can trigger this)
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    const delay = Math.min(this.currentReconnectDelay, RECONNECT_MAX_MS);
    this.currentReconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS);

    this.logger.info(`ClawTalk reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.createConnection();
      } catch (err) {
        this.logger.error?.(`Reconnect failed: ${String(err)}`);
        if (!this.isShuttingDown) {
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  // ── Message handling ──────────────────────────────────

  private parseMessage(data: WebSocket.Data): WsInboundMessage | null {
    try {
      return JSON.parse(data.toString()) as WsInboundMessage;
    } catch {
      this.logger.warn?.('Failed to parse WebSocket message');
      return null;
    }
  }

  private dispatchEvent(msg: WsEvent): void {
    switch (msg.event) {
      case 'context_request':
        this.emit('context_request', msg);
        break;
      case 'call.started':
        this.emit('call.started', msg);
        break;
      case 'call.ended':
        this.emit('call.ended', msg);
        break;
      case 'deep_tool_request':
        this.emit('deep_tool_request', msg);
        break;
      case 'sms.received':
        this.emit('sms.received', msg);
        break;
      case 'approval.responded':
        this.emit('approval.responded', msg);
        break;
      case 'walkie_request':
        this.emit('walkie_request', msg);
        break;
      default:
        this.logger.debug?.(`Unhandled event: ${(msg as WsEvent).event}`);
    }
  }
}
