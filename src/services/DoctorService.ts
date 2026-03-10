/**
 * DoctorService — hybrid health checks (local plugin + server-side).
 *
 * Local checks: WebSocket connected, extensionAPI loadable, client version.
 * Server checks: critical, warnings, recommended, infra (fetched from /v1/doctor/*).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ClawTalkClient } from '../lib/clawtalk-sdk/index.js';
import type { DoctorCheckResult } from '../lib/clawtalk-sdk/namespaces/doctor.js';
import type { Logger } from '../types/plugin.js';
import type { ICoreBridge } from './CoreBridge.js';
import type { WebSocketService } from './WebSocketService.js';

// ── Types ───────────────────────────────────────────────────

export interface DoctorCheck {
  readonly id: string;
  readonly status: 'pass' | 'fail' | 'warn';
  readonly detail: string | null;
  readonly source: 'local' | 'server';
}

export interface DoctorReport {
  readonly local: DoctorCheck[];
  readonly server: {
    critical: DoctorCheckResult | null;
    warnings: DoctorCheckResult | null;
    recommended: DoctorCheckResult | null;
    infra: DoctorCheckResult | null;
  };
}

// ── Service ─────────────────────────────────────────────────

export class DoctorService {
  private readonly client: ClawTalkClient;
  private readonly ws: WebSocketService;
  private readonly coreBridge: ICoreBridge | null;
  private readonly logger: Logger;
  private readonly openclawRoot: string | null;

  constructor(deps: {
    client: ClawTalkClient;
    ws: WebSocketService;
    coreBridge?: ICoreBridge;
    logger: Logger;
    openclawRoot?: string;
  }) {
    this.client = deps.client;
    this.ws = deps.ws;
    this.coreBridge = deps.coreBridge ?? null;
    this.logger = deps.logger;
    this.openclawRoot = deps.openclawRoot ?? null;
  }

  async runAll(): Promise<DoctorReport> {
    const [local, server] = await Promise.all([this.runLocal(), this.runServer()]);
    return { local, server };
  }

  async runLocal(): Promise<DoctorCheck[]> {
    const checks: DoctorCheck[] = [];

    // 1. WebSocket connected
    checks.push({
      id: 'ws_connected',
      status: this.ws.isConnected ? 'pass' : 'fail',
      detail: this.ws.isConnected ? 'WebSocket connected' : 'WebSocket disconnected',
      source: 'local',
    });

    // 2. extensionAPI.js loadable
    const extCheck = this.checkExtensionApi();
    checks.push(extCheck);

    // 3. Client version
    const versionCheck = this.checkClientVersion();
    checks.push(versionCheck);

    // 4. Deep tool ping/pong (CoreBridge agent roundtrip)
    const deepToolCheck = await this.checkDeepToolPingPong();
    checks.push(deepToolCheck);

    return checks;
  }

  async runServer(): Promise<DoctorReport['server']> {
    const fetchCategory = async (
      name: string,
      fn: () => Promise<DoctorCheckResult>,
    ): Promise<DoctorCheckResult | null> => {
      try {
        return await fn();
      } catch (err) {
        this.logger.warn?.(`Doctor ${name} fetch failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    };

    const [critical, warnings, recommended, infra] = await Promise.all([
      fetchCategory('critical', () => this.client.doctor.critical()),
      fetchCategory('warnings', () => this.client.doctor.warnings()),
      fetchCategory('recommended', () => this.client.doctor.recommended()),
      fetchCategory('infra', () => this.client.doctor.infra()),
    ]);

    return { critical, warnings, recommended, infra };
  }

  // ── Private ─────────────────────────────────────────────

  private checkExtensionApi(): DoctorCheck {
    try {
      const candidates: string[] = [];

      if (this.openclawRoot) {
        candidates.push(path.join(this.openclawRoot, 'dist', 'extensionAPI.js'));
      }
      if (process.argv[1]) {
        candidates.push(path.join(path.dirname(process.argv[1]), '..', 'dist', 'extensionAPI.js'));
      }

      const found = candidates.some((p) => fs.existsSync(p));

      return {
        id: 'extension_api',
        status: found ? 'pass' : 'fail',
        detail: found ? 'extensionAPI.js found' : 'extensionAPI.js not found',
        source: 'local',
      };
    } catch {
      return {
        id: 'extension_api',
        status: 'fail',
        detail: 'Failed to check extensionAPI.js',
        source: 'local',
      };
    }
  }

  private checkClientVersion(): DoctorCheck {
    const version = this.ws.version;
    // Basic version sanity check (not a proper semver comparison with server)
    if (version === '0.0.0') {
      return {
        id: 'client_version',
        status: 'warn',
        detail: 'Unable to read client version from package.json',
        source: 'local',
      };
    }

    return {
      id: 'client_version',
      status: 'pass',
      detail: `Client version: ${version}`,
      source: 'local',
    };
  }

  private async checkDeepToolPingPong(): Promise<DoctorCheck> {
    if (!this.coreBridge) {
      return {
        id: 'deep_tool_ping',
        status: 'warn',
        detail: 'CoreBridge not available, cannot test deep tool roundtrip',
        source: 'local',
      };
    }

    const startMs = Date.now();
    try {
      const result = await this.coreBridge.runAgentTurn({
        sessionKey: 'clawtalk:doctor:ping',
        prompt: 'Respond with exactly: pong',
        timeoutMs: 15000,
      });

      const latencyMs = Date.now() - startMs;
      const gotResponse = result !== null && result.trim().length > 0;

      return {
        id: 'deep_tool_ping',
        status: gotResponse ? 'pass' : 'fail',
        detail: gotResponse
          ? `Deep tool roundtrip OK (${latencyMs}ms)`
          : `Deep tool returned empty response (${latencyMs}ms)`,
        source: 'local',
      };
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      return {
        id: 'deep_tool_ping',
        status: 'fail',
        detail: `Deep tool roundtrip failed (${latencyMs}ms): ${err instanceof Error ? err.message : String(err)}`,
        source: 'local',
      };
    }
  }
}
