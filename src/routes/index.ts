/**
 * HTTP routes registered on the OpenClaw gateway server.
 *
 * GET  /clawtalk/health  — Doctor checks + status
 * POST /clawtalk/webhook  — Future server-side callbacks (stub)
 *
 * Uses raw Node.js IncomingMessage/ServerResponse (not Express).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DoctorService } from '../services/DoctorService.js';
import type { WebSocketService } from '../services/WebSocketService.js';
import type { Logger } from '../types/plugin.js';

// ── Types ───────────────────────────────────────────────────

export interface RoutesDeps {
  readonly doctor: DoctorService;
  readonly ws: WebSocketService;
  readonly version: string;
  readonly startedAt: number;
  readonly logger: Logger;
}

// ── Handlers ────────────────────────────────────────────────

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createHealthHandler(deps: RoutesDeps) {
  return async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const doctor = await deps.doctor.runAll();
      const uptime = Math.floor((Date.now() - deps.startedAt) / 1000);

      jsonResponse(res, 200, {
        status: 'ok',
        version: deps.version,
        wsConnected: deps.ws.isConnected,
        uptime,
        doctor,
      });
    } catch (err) {
      deps.logger.error?.(`Health check failed: ${err instanceof Error ? err.message : String(err)}`);
      jsonResponse(res, 500, { status: 'error', error: 'Health check failed' });
    }
  };
}

export function createWebhookHandler(deps: RoutesDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Read body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }

    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    } catch {
      jsonResponse(res, 400, { error: 'Invalid JSON' });
      return;
    }

    deps.logger.info(`Webhook received: ${JSON.stringify(body).substring(0, 200)}`);
    jsonResponse(res, 200, { received: true });
  };
}
