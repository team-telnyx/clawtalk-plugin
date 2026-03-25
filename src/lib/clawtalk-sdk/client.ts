/**
 * ClawTalkClient — Stripe-style namespaced SDK for the ClawTalk REST API.
 *
 * Usage:
 *   const client = new ClawTalkClient({ apiKey, server });
 *   await client.calls.initiate({ to: '+1234567890' });
 *   await client.missions.runs.create(missionId, input);
 *
 * Zero plugin dependencies. Uses native fetch only.
 */

import { ApiError } from './errors.js';
import { ApprovalsNamespace } from './namespaces/approvals.js';
import { AssistantsNamespace } from './namespaces/assistants.js';
import type { RequestFn } from './namespaces/calls.js';
import { CallsNamespace } from './namespaces/calls.js';
import { DoctorNamespace } from './namespaces/doctor.js';
import { InsightsNamespace } from './namespaces/insights.js';
import { MissionsNamespace } from './namespaces/missions.js';
import { NumbersNamespace } from './namespaces/numbers.js';
import { SmsNamespace } from './namespaces/sms.js';
import { UserNamespace } from './namespaces/user.js';
import { VoicesNamespace } from './namespaces/voices.js';

export interface ClawTalkClientConfig {
  readonly apiKey: string;
  readonly server: string;
  readonly clientVersion?: string;
  readonly logger?: {
    debug?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
  };
  readonly timeoutMs?: number;
}

export class ClawTalkClient {
  readonly calls: CallsNamespace;
  readonly sms: SmsNamespace;
  readonly missions: MissionsNamespace;
  readonly assistants: AssistantsNamespace;
  readonly approvals: ApprovalsNamespace;
  readonly user: UserNamespace;
  readonly numbers: NumbersNamespace;
  readonly insights: InsightsNamespace;
  readonly doctor: DoctorNamespace;
  readonly voices: VoicesNamespace;

  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly logger: ClawTalkClientConfig['logger'];
  private readonly timeoutMs: number;

  constructor(config: ClawTalkClientConfig) {
    this.baseUrl = config.server.replace(/\/$/, '');
    this.headers = {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      ...(config.clientVersion ? { 'X-Client-Version': config.clientVersion } : {}),
    };
    this.logger = config.logger;
    this.timeoutMs = config.timeoutMs ?? 30000;

    // Bind the shared request method and wire all namespaces
    const request: RequestFn = this.request.bind(this);
    this.calls = new CallsNamespace(request);
    this.sms = new SmsNamespace(request);
    this.missions = new MissionsNamespace(request);
    this.assistants = new AssistantsNamespace(request);
    this.approvals = new ApprovalsNamespace(request);
    this.user = new UserNamespace(request);
    this.numbers = new NumbersNamespace(request);
    this.insights = new InsightsNamespace(request);
    this.doctor = new DoctorNamespace(request);
    this.voices = new VoicesNamespace(request);
  }

  private async request<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const signal = AbortSignal.timeout(this.timeoutMs);

    this.logger?.debug?.(`${method} ${endpoint}`);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: this.headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new ApiError(408, `Request timed out: ${method} ${endpoint}`);
      }
      throw new ApiError(0, `Network error: ${method} ${endpoint} — ${String(err)}`);
    }

    const responseBody = await response.text();

    if (!response.ok) {
      this.logger?.warn?.(`API ${response.status}: ${method} ${endpoint}`);
      throw new ApiError(response.status, `${method} ${endpoint} failed: ${response.status}`, responseBody);
    }

    if (!responseBody) {
      return {} as T;
    }

    try {
      return JSON.parse(responseBody) as T;
    } catch {
      throw new ApiError(0, `Invalid JSON response: ${method} ${endpoint}`);
    }
  }
}
