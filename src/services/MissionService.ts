/**
 * MissionService — orchestrates the full mission lifecycle.
 *
 * Mirrors the Python telnyx_api.py high-level functions:
 *   initMission, setupVoiceAgent, completeMission,
 *   scheduleCall, scheduleSms, logEvent, saveMemory, etc.
 *
 * Owns the local state file (.missions_state.json) and all
 * server API calls through ClawTalkClient.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClawTalkClient } from '../lib/clawtalk-sdk/client.js';
import type {
  CompleteMissionParams,
  InitMissionParams,
  InitMissionResult,
  LogEventParams,
  MissionSlugState,
  MissionsStateFile,
  ScheduleCallEventParams,
  ScheduleSmsEventParams,
  SetupAgentParams,
  SetupAgentResult,
} from '../types/missions.js';
import type { Logger } from '../types/plugin.js';

const STATE_FILENAME = '.missions_state.json';

// ── Helpers ───────────────────────────────────────────────────

/** Convert a name to a URL-safe slug (matches Python slugify). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ── MissionService ────────────────────────────────────────────

export class MissionService {
  private readonly client: ClawTalkClient;

  /** Expose SDK client for tools that need direct API access (e.g. server-side mission list). */
  getClient(): ClawTalkClient {
    return this.client;
  }
  private readonly logger: Logger;
  private readonly stateFilePath: string;

  constructor(params: { client: ClawTalkClient; logger: Logger; dataDir: string }) {
    this.client = params.client;
    this.logger = params.logger;
    this.stateFilePath = join(params.dataDir, STATE_FILENAME);
  }

  // ── State persistence ───────────────────────────────────────

  async loadState(): Promise<MissionsStateFile> {
    try {
      const raw = await readFile(this.stateFilePath, 'utf-8');
      return JSON.parse(raw) as MissionsStateFile;
    } catch {
      return {};
    }
  }

  async saveState(state: MissionsStateFile): Promise<void> {
    const dir = this.stateFilePath.replace(/[/\\][^/\\]+$/, '');
    await mkdir(dir, { recursive: true });
    await writeFile(this.stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  async getSlugState(slug: string): Promise<MissionSlugState> {
    const state = await this.loadState();
    return state[slug] ?? {};
  }

  async updateSlugState(slug: string, updates: Partial<MissionSlugState>): Promise<void> {
    const state = await this.loadState();
    state[slug] = { ...(state[slug] ?? {}), ...updates };
    await this.saveState(state);
  }

  async removeSlugState(slug: string): Promise<void> {
    const state = await this.loadState();
    delete state[slug];
    await this.saveState(state);
  }

  // ── Memory ──────────────────────────────────────────────────

  async saveMemory(slug: string, key: string, value: unknown): Promise<void> {
    const state = await this.loadState();
    const entry = state[slug] ?? {};
    const memory = entry.memory ?? {};
    memory[key] = value;
    entry.memory = memory;
    entry.last_updated = utcNow();
    state[slug] = entry;
    await this.saveState(state);
    this.logger.info(`Saved memory '${key}' for mission '${slug}'`);
  }

  async getMemory(slug: string, key?: string): Promise<unknown> {
    const s = await this.getSlugState(slug);
    const mem = s.memory ?? {};
    return key ? mem[key] : mem;
  }

  async appendMemory(slug: string, key: string, item: unknown): Promise<number> {
    const state = await this.loadState();
    const entry = state[slug] ?? {};
    const memory = entry.memory ?? {};
    const existing = memory[key];
    let arr: unknown[];
    if (Array.isArray(existing)) {
      arr = existing;
    } else if (existing !== undefined && existing !== null) {
      arr = [existing];
    } else {
      arr = [];
    }
    arr.push(item);
    memory[key] = arr;
    entry.memory = memory;
    entry.last_updated = utcNow();
    state[slug] = entry;
    await this.saveState(state);
    this.logger.info(`Appended to memory '${key}' for mission '${slug}' (now ${arr.length} items)`);
    return arr.length;
  }

  // ── High-level workflow ─────────────────────────────────────

  /**
   * Initialize a mission with run and optional plan.
   * Idempotent: resumes existing mission if slug already has IDs in state.
   */
  async initMission(params: InitMissionParams): Promise<InitMissionResult> {
    const slug = slugify(params.name);
    const existing = await this.getSlugState(slug);

    // Resume if both IDs exist
    if (existing.mission_id && existing.run_id) {
      this.logger.info(`Resuming existing mission: ${slug}`);
      return {
        missionId: existing.mission_id,
        runId: existing.run_id,
        slug,
        resumed: true,
      };
    }

    // Create mission
    const mission = await this.client.missions.create({
      name: params.name,
      instructions: params.instructions,
    });
    const missionId = mission.id;
    this.logger.info(`Created mission: ${missionId}`);

    await this.updateSlugState(slug, {
      mission_name: params.name,
      mission_id: missionId,
      created_at: utcNow(),
    });

    // Create run — namespace wraps in { input }, so pass the inner object
    const run = await this.client.missions.runs.create(missionId, {
      original_request: params.request,
    });
    const runId = run.run_id;
    this.logger.info(`Created run: ${runId}`);
    await this.updateSlugState(slug, { run_id: runId });

    // Create plan if steps provided
    if (params.steps?.length) {
      const planSteps = params.steps.map((s, i) => ({
        step_id: slugify(s.title),
        sequence: i + 1,
        title: s.title,
        description: s.description,
        status: 'pending' as const,
      }));
      await this.client.missions.plans.create(missionId, runId, planSteps);
      this.logger.info(`Created plan with ${planSteps.length} steps`);
    }

    // Set run to running
    await this.client.missions.runs.update(missionId, runId, { status: 'running' });

    return { missionId, runId, slug, resumed: false };
  }

  /**
   * Create voice assistant, get a phone number, and link to mission run.
   * Idempotent: returns existing assistant if already set up for this slug.
   */
  async setupVoiceAgent(params: SetupAgentParams): Promise<SetupAgentResult> {
    const existing = await this.getSlugState(params.missionSlug);

    // Resume if assistant already set up
    if (existing.assistant_id && existing.agent_phone) {
      this.logger.info(`Using existing assistant: ${existing.assistant_id}`);
      return {
        assistantId: existing.assistant_id,
        phone: existing.agent_phone,
      };
    }

    // Create assistant
    const assistant = await this.client.assistants.create({
      name: params.name,
      instructions: params.instructions,
      greeting: params.greeting ?? '',
      voice: params.voice,
      model: params.model ?? 'openai/gpt-4o',
      tools: params.tools as Array<{ type: string; [key: string]: unknown }>,
      enabled_features: params.features ?? ['telephony', 'messaging'],
      description: params.description,
    });
    const assistantId = assistant.id;
    this.logger.info(`Created assistant: ${assistantId}`);
    await this.updateSlugState(params.missionSlug, { assistant_id: assistantId });

    // Link agent to mission run
    const missionId = existing.mission_id;
    const runId = existing.run_id;
    if (missionId && runId) {
      await this.client.missions.agents.link(missionId, runId, assistantId);
      this.logger.info(`Linked agent ${assistantId} to run ${runId}`);
    }

    // Get available phone
    let phone: string | null = null;
    try {
      const phoneResult = await this.client.numbers.available();
      phone = phoneResult.phone_number;
      await this.updateSlugState(params.missionSlug, {
        agent_phone: phone,
        phone_number_id: phoneResult.id,
      });
      this.logger.info(`Assigned phone: ${phone}`);
    } catch {
      this.logger.info(
        'WARN: No available phone number found. Outbound calls/SMS cannot be scheduled without a dedicated number.',
      );
    }

    return { assistantId, phone };
  }

  /**
   * Complete a mission: update run status and remove state.
   * Rejects if any plan steps are still non-terminal (pending/in_progress).
   */
  async completeMission(params: CompleteMissionParams): Promise<void> {
    const existing = await this.getSlugState(params.missionSlug);
    const missionId = existing.mission_id;
    const runId = existing.run_id;

    if (!missionId || !runId) {
      throw new Error(`No active mission found for slug '${params.missionSlug}'`);
    }

    // Guard: all steps must be in a terminal state before completing
    const steps = await this.client.missions.plans.get(missionId, runId);
    const nonTerminal = steps.filter(
      (s) => s.status !== 'completed' && s.status !== 'failed' && s.status !== 'skipped',
    );
    if (nonTerminal.length > 0) {
      const summary = nonTerminal.map((s) => `${s.step_id} (${s.status})`).join(', ');
      throw new Error(
        `Cannot complete mission '${params.missionSlug}': ${nonTerminal.length} step(s) still non-terminal: ${summary}. ` +
          `Mark each step as completed, failed, or skipped before completing the mission.`,
      );
    }

    await this.client.missions.runs.update(missionId, runId, {
      status: 'succeeded',
      result_summary: params.summary,
      result_payload: params.payload,
    });

    await this.removeSlugState(params.missionSlug);
    this.logger.info(`Mission '${params.missionSlug}' completed successfully`);
  }

  // ── Scheduling ──────────────────────────────────────────────

  /** Schedule a call event for a mission. */
  async scheduleCall(params: ScheduleCallEventParams): Promise<string> {
    const existing = await this.getSlugState(params.missionSlug);
    if (!existing.assistant_id || !existing.agent_phone) {
      throw new Error(`Mission '${params.missionSlug}' has no assistant/phone set up`);
    }
    if (!existing.mission_id || !existing.run_id) {
      throw new Error(`Mission '${params.missionSlug}' has no mission/run IDs`);
    }

    const event = await this.client.assistants.events.schedule({
      assistant_id: existing.assistant_id,
      to: params.to,
      from: existing.agent_phone,
      scheduled_at: params.scheduledAt,
      mission_id: existing.mission_id,
      run_id: existing.run_id,
      step_id: params.stepId,
    });

    this.logger.info(`Scheduled call: ${event.id}`);
    return event.id;
  }

  /** Schedule an SMS event for a mission. */
  async scheduleSms(params: ScheduleSmsEventParams): Promise<string> {
    const existing = await this.getSlugState(params.missionSlug);
    if (!existing.assistant_id || !existing.agent_phone) {
      throw new Error(`Mission '${params.missionSlug}' has no assistant/phone set up`);
    }
    if (!existing.mission_id || !existing.run_id) {
      throw new Error(`Mission '${params.missionSlug}' has no mission/run IDs`);
    }

    const event = await this.client.assistants.events.schedule({
      assistant_id: existing.assistant_id,
      to: params.to,
      from: existing.agent_phone,
      scheduled_at: params.scheduledAt,
      text_body: params.textBody,
      mission_id: existing.mission_id,
      run_id: existing.run_id,
      step_id: params.stepId,
    });

    this.logger.info(`Scheduled SMS: ${event.id}`);
    return event.id;
  }

  // ── Events ──────────────────────────────────────────────────

  /** Log a mission event. */
  async logEvent(slug: string, params: LogEventParams): Promise<string> {
    const existing = await this.getSlugState(slug);
    if (!existing.mission_id || !existing.run_id) {
      throw new Error(`No active mission found for slug '${slug}'`);
    }

    const event = await this.client.missions.events.log(existing.mission_id, existing.run_id, {
      type: params.type,
      summary: params.summary,
      agent_id: params.agentId ?? 'openclaw-plugin',
      step_id: params.stepId,
      payload: params.payload,
    });

    this.logger.info(`Logged event: ${params.summary}`);
    return event.id;
  }

  // ── Query helpers ───────────────────────────────────────────

  /** List all mission slugs in state. */
  async listMissions(): Promise<Array<{ slug: string; state: MissionSlugState }>> {
    const state = await this.loadState();
    return Object.entries(state).map(([slug, s]) => ({ slug, state: s }));
  }

  /** Get plan steps for a mission from server. */
  async getPlan(slug: string) {
    const existing = await this.getSlugState(slug);
    if (!existing.mission_id || !existing.run_id) {
      throw new Error(`No active mission found for slug '${slug}'`);
    }
    return this.client.missions.plans.get(existing.mission_id, existing.run_id);
  }

  /** Get aggregate events for a mission from server. */
  async getEvents(slug: string) {
    const existing = await this.getSlugState(slug);
    if (!existing.mission_id) {
      throw new Error(`No active mission found for slug '${slug}'`);
    }
    return this.client.missions.events.aggregate(existing.mission_id);
  }

  /**
   * Update a plan step status with state machine enforcement.
   *
   * Valid transitions:
   *   pending → in_progress
   *   pending → skipped
   *   in_progress → completed
   *   in_progress → failed
   *   in_progress → skipped
   *
   * Terminal states (completed, failed, skipped) cannot transition backwards.
   */
  async updatePlanStep(slug: string, stepId: string, status: string) {
    const existing = await this.getSlugState(slug);
    if (!existing.mission_id || !existing.run_id) {
      throw new Error(`No active mission found for slug '${slug}'`);
    }

    // Fetch current step status for state machine validation
    const steps = await this.client.missions.plans.get(existing.mission_id, existing.run_id);
    const step = steps.find((s) => s.step_id === stepId);
    if (!step) {
      throw new Error(`Step '${stepId}' not found in mission '${slug}'`);
    }

    const TERMINAL = new Set(['completed', 'failed', 'skipped']);
    const VALID_TRANSITIONS: Record<string, Set<string>> = {
      pending: new Set(['in_progress', 'skipped']),
      in_progress: new Set(['completed', 'failed', 'skipped']),
    };

    if (TERMINAL.has(step.status)) {
      throw new Error(
        `Cannot update step '${stepId}': already in terminal state '${step.status}'. Terminal states (completed, failed, skipped) cannot be changed.`,
      );
    }

    const allowed = VALID_TRANSITIONS[step.status];
    if (allowed && !allowed.has(status)) {
      throw new Error(
        `Invalid transition for step '${stepId}': '${step.status}' → '${status}'. ` +
          `Allowed transitions from '${step.status}': ${[...(allowed ?? [])].join(', ')}.`,
      );
    }

    return this.client.missions.plans.updateStep(existing.mission_id, existing.run_id, stepId, status);
  }

  /** Get scheduled event status. */
  async getScheduledEvent(slug: string, eventId: string) {
    const existing = await this.getSlugState(slug);
    if (!existing.assistant_id) {
      throw new Error(`Mission '${slug}' has no assistant set up`);
    }
    return this.client.assistants.events.get(existing.assistant_id, eventId);
  }

  /** Cancel a scheduled event. */
  async cancelScheduledEvent(slug: string, eventId: string) {
    const existing = await this.getSlugState(slug);
    if (!existing.assistant_id) {
      throw new Error(`Mission '${slug}' has no assistant set up`);
    }
    await this.client.assistants.events.cancel(existing.assistant_id, eventId);
    this.logger.info(`Cancelled scheduled event: ${eventId}`);
  }

  /** Get conversation insights. */
  async getInsights(conversationId: string) {
    return this.client.insights.get(conversationId);
  }
}
