/**
 * Dedicated WebSocket log file for ClawTalk.
 *
 * Writes all WS traffic (inbound, outbound, lifecycle) to a rolling log file
 * separate from gateway logs. Redacts sensitive fields (api_key).
 *
 * Log path: {pluginDataDir}/ws.log
 */

import type { WriteStream } from 'node:fs';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ROTATION_CHECK_INTERVAL = 100; // Check rotation every N writes
const MAX_REDACT_DEPTH = 10;
const REDACTED = '[REDACTED]';

const SENSITIVE_KEYS = new Set(['api_key', 'apiKey', 'authorization', 'token', 'secret']);

/** Message types that are internal plumbing and should not appear in logs. */
const SUPPRESSED_TYPES = new Set(['request_logs', 'logs_response']);

// ── Redaction ───────────────────────────────────────────────

function redact(obj: unknown, depth = 0): unknown {
  if (depth > MAX_REDACT_DEPTH) return '[max depth]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) return obj.map((item) => redact(item, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = REDACTED;
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redact(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── WsLogger ────────────────────────────────────────────────

export class WsLogger {
  private stream: WriteStream | null = null;
  private writeCount = 0;

  /** Absolute path to the active log file. */
  readonly path: string;

  constructor(logPath: string) {
    this.path = logPath;
  }

  /**
   * Open the log file for appending. Creates parent dirs if needed.
   */
  open(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.rotateIfNeeded();
    this.createStream();
  }

  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }

  /** Log an outbound message (client → server) */
  outbound(msg: unknown): void {
    this.write('>>>', msg);
  }

  /** Log an inbound message (server → client) */
  inbound(msg: unknown): void {
    this.write('<<<', msg);
  }

  /** Log a lifecycle event (connect, disconnect, error, etc.) */
  lifecycle(event: string, detail?: string): void {
    const ts = new Date().toISOString();
    const line = detail ? `${ts} --- ${event}: ${detail}` : `${ts} --- ${event}`;
    this.writeLine(line);
  }

  /** Read the last N lines from the log file. Safe to call while writing. */
  readRecentLines(maxLines = 200): string[] {
    try {
      if (!existsSync(this.path)) return [];
      const content = readFileSync(this.path, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      return lines.slice(Math.max(0, lines.length - maxLines));
    } catch {
      return [];
    }
  }

  // ── Private ─────────────────────────────────────────────

  private createStream(): void {
    this.stream = createWriteStream(this.path, { flags: 'a' });
    this.stream.on('error', () => {
      // Silently disable logging on stream error (disk full, permissions, etc.)
      // rather than crashing the gateway process.
      this.stream = null;
    });
  }

  private write(direction: '>>>' | '<<<', msg: unknown): void {
    // Suppress internal log-fetching chatter
    if (msg && typeof msg === 'object' && 'type' in msg && SUPPRESSED_TYPES.has((msg as { type: string }).type)) {
      return;
    }
    const ts = new Date().toISOString();
    const safe = redact(msg);
    let payload: string;
    try {
      payload = JSON.stringify(safe);
    } catch {
      payload = String(msg);
    }
    this.writeLine(`${ts} ${direction} ${payload}`);
  }

  private writeLine(line: string): void {
    if (!this.stream) return;
    this.stream.write(`${line}\n`);

    // Periodic rotation check (avoids stat() on every write)
    this.writeCount++;
    if (this.writeCount >= ROTATION_CHECK_INTERVAL) {
      this.writeCount = 0;
      if (this.rotateIfNeeded()) {
        // Re-open stream pointing at new file
        this.stream.end();
        this.createStream();
      }
    }
  }

  /**
   * Rotate the log file if it exceeds the size limit.
   * Returns true if rotation occurred.
   */
  private rotateIfNeeded(): boolean {
    try {
      if (existsSync(this.path)) {
        const stat = statSync(this.path);
        if (stat.size > MAX_LOG_SIZE_BYTES) {
          const rotated = `${this.path}.1`;
          renameSync(this.path, rotated);
          return true;
        }
      }
    } catch {
      // Best-effort rotation
    }
    return false;
  }
}
