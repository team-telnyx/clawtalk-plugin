/**
 * MissionEventHandler — processes real-time mission events from the server
 * and injects them into the appropriate mission session via CoreBridge.
 *
 * Listens for 'mission.event' on the WebSocketService and formats each event
 * into a human-readable system event for the agent to act on.
 */

import type { Logger } from '../types/plugin.js';
import type {
  WsMissionCallCompleted,
  WsMissionCallFailed,
  WsMissionCallStarted,
  WsMissionEvent,
  WsMissionInsightsReady,
  WsMissionSmsDelivered,
  WsMissionSmsReceived,
} from '../types/websocket.js';
import type { CoreBridge } from './CoreBridge.js';
import type { MissionService } from './MissionService.js';
import type { WebSocketService } from './WebSocketService.js';

export class MissionEventHandler {
  private readonly ws: WebSocketService;
  private readonly coreBridge: CoreBridge;
  private readonly missions: MissionService;
  private readonly logger: Logger;

  constructor(deps: {
    ws: WebSocketService;
    coreBridge: CoreBridge;
    missions: MissionService;
    logger: Logger;
  }) {
    this.ws = deps.ws;
    this.coreBridge = deps.coreBridge;
    this.missions = deps.missions;
    this.logger = deps.logger;
  }

  /** Start listening for mission events on the WebSocket. */
  start(): void {
    this.ws.on('mission.event', (msg: WsMissionEvent) => {
      this.handleEvent(msg).catch((err) => {
        this.logger.error?.(`Failed to handle mission event ${msg.event}: ${err}`);
      });
    });
    this.logger.info('MissionEventHandler started');
  }

  /**
   * Resolve mission_id to the local slug for session routing.
   * Returns null if the mission isn't tracked locally.
   */
  private async resolveSlug(missionId: string): Promise<string | null> {
    const missions = await this.missions.listMissions();
    const match = missions.find((m) => m.state.mission_id === missionId);
    return match?.slug ?? null;
  }

  private async handleEvent(msg: WsMissionEvent): Promise<void> {
    const text = this.formatEvent(msg);
    if (!text) return;

    const slug = await this.resolveSlug(msg.mission_id);
    if (!slug) {
      this.logger.warn?.(`[MissionEvent] No local state for mission ${msg.mission_id}, dropping ${msg.event}`);
      return;
    }

    // Store transcript in mission memory before agent turn (so agent can reference it)
    if (msg.event === 'mission.call_completed') {
      await this.storeTranscript(slug, msg as WsMissionCallCompleted);
    }

    // Fetch all mission memory and append to event text so the agent has full context
    const memoryContext = await this.getMemoryContext(slug);
    const fullText = memoryContext ? `${text}\n\n${memoryContext}` : text;

    // Each mission gets its own persistent CoreBridge session (7B.3).
    // runAgentTurn creates the session on first call and resumes it on subsequent calls.
    // The agent sees the formatted event as a prompt and can act on it immediately
    // using mission tools (update_step, complete, memory, etc.).
    const sessionKey = `clawtalk:mission:${slug}`;

    this.logger.info(`[MissionEvent] Running agent turn for ${msg.event} in session ${sessionKey}`);

    try {
      const response = await this.coreBridge.runAgentTurn({
        sessionKey,
        prompt: fullText,
        extraSystemPrompt: this.buildMissionSystemPrompt(slug, msg.mission_id),
        timeoutMs: 120_000,
      });

      this.logger.info(
        `[MissionEvent] Agent turn complete for ${sessionKey}: ${response ? response.slice(0, 100) : '(no response)'}`,
      );
    } catch (err) {
      this.logger.error?.(
        `[MissionEvent] Agent turn failed for ${sessionKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Build a system prompt that gives the mission session agent enough context
   * to process events and use mission tools correctly.
   */
  private buildMissionSystemPrompt(slug: string, missionId: string): string {
    return [
      `You are handling events for mission "${slug}" (ID: ${missionId}).`,
      'You have access to ClawTalk mission tools. Use them to progress this mission.',
      '',
      'When you receive a mission event:',
      '1. Review the event details carefully',
      '2. Extract key information and save to mission memory if relevant',
      '3. Update the step status (e.g. in_progress → completed)',
      '4. If all steps are done and the mission goal is achieved, complete the mission',
      '5. If a step failed, decide whether to retry or mark it failed',
      '',
      'Step state machine: pending → in_progress → completed/failed/skipped. No backwards transitions.',
      'You cannot complete a mission while steps are still pending or in_progress.',
    ].join('\n');
  }

  private formatEvent(msg: WsMissionEvent): string | null {
    switch (msg.event) {
      case 'mission.call_started':
        return this.formatCallStarted(msg as WsMissionCallStarted);
      case 'mission.call_completed':
        return this.formatCallCompleted(msg as WsMissionCallCompleted);
      case 'mission.call_failed':
        return this.formatCallFailed(msg as WsMissionCallFailed);
      case 'mission.insights_ready':
        return this.formatInsightsReady(msg as WsMissionInsightsReady);
      case 'mission.sms_delivered':
        return this.formatSmsDelivered(msg as WsMissionSmsDelivered);
      case 'mission.sms_received':
        return this.formatSmsReceived(msg as WsMissionSmsReceived);
      default:
        return null;
    }
  }

  private formatCallStarted(msg: WsMissionCallStarted): string {
    return (
      `[Mission Event] Call started\n` +
      `Mission: ${msg.mission_id}${msg.step_id ? ` | Step: ${msg.step_id}` : ''}\n` +
      `From: ${msg.from} → To: ${msg.to}\n` +
      `Conversation ID: ${msg.conversation_id || 'pending'}\n` +
      `Action: Update step to in_progress if not already done.`
    );
  }

  private formatCallCompleted(msg: WsMissionCallCompleted): string {
    const transcriptText =
      msg.transcript.length > 0
        ? msg.transcript.map((t) => `  [${t.role}]: ${t.content}`).join('\n')
        : '  (no transcript available)';

    return (
      `[Mission Event] Call completed\n` +
      `Mission: ${msg.mission_id}${msg.step_id ? ` | Step: ${msg.step_id}` : ''}\n` +
      `From: ${msg.from} → To: ${msg.to}\n` +
      `Duration: ${msg.duration_sec ?? '?'}s | Reason: ${msg.reason || 'hangup'}\n` +
      `Conversation ID: ${msg.conversation_id || 'unknown'}\n\n` +
      `Transcript (last ${msg.transcript.length} messages):\n${transcriptText}\n\n` +
      `Action: Review the transcript, extract key information, save to mission memory, and update the step status.`
    );
  }

  private formatCallFailed(msg: WsMissionCallFailed): string {
    return (
      `[Mission Event] Call FAILED\n` +
      `Mission: ${msg.mission_id}${msg.step_id ? ` | Step: ${msg.step_id}` : ''}\n` +
      `From: ${msg.from} → To: ${msg.to}\n` +
      `Reason: ${msg.reason}\n\n` +
      `Action: Decide if this is retryable (no-answer, busy → reschedule) or terminal (→ mark step failed).`
    );
  }

  private formatInsightsReady(msg: WsMissionInsightsReady): string {
    return (
      `[Mission Event] AI insights ready\n` +
      `Mission: ${msg.mission_id}${msg.step_id ? ` | Step: ${msg.step_id}` : ''}\n` +
      `Conversation ID: ${msg.conversation_id || 'unknown'}\n\n` +
      `Summary: ${msg.summary || '(empty)'}\n\n` +
      `Action: Save insights to mission memory for final analysis.`
    );
  }

  private formatSmsDelivered(msg: WsMissionSmsDelivered): string {
    const errorText = msg.errors.length > 0 ? `\nErrors: ${msg.errors.join(', ')}` : '';
    return (
      `[Mission Event] SMS ${msg.status}\n` +
      `Mission: ${msg.mission_id}${msg.step_id ? ` | Step: ${msg.step_id}` : ''}\n` +
      `From: ${msg.from} → To: ${msg.to}\n` +
      `Status: ${msg.status}${errorText}\n\n` +
      `Action: Update step status based on delivery result.`
    );
  }

  private formatSmsReceived(msg: WsMissionSmsReceived): string {
    let threadText = '';
    if (msg.thread_context && msg.thread_context.length > 0) {
      const lines = msg.thread_context.map((m) => `  [${m.direction}] ${m.from} → ${m.to}: ${m.text}`);
      threadText = `\nConversation thread (last ${msg.thread_context.length} messages):\n${lines.join('\n')}\n`;
    }

    return (
      `[Mission Event] SMS reply received\n` +
      `Mission: ${msg.mission_id}${msg.step_id ? ` | Step: ${msg.step_id}` : ''}\n` +
      `From: ${msg.from} → To: ${msg.to}\n\n` +
      `Message: ${msg.text}\n` +
      `${threadText}\n` +
      `Action: Review the reply, extract key information, save to mission memory, and update the step status. If the mission goal is achieved, complete the mission.`
    );
  }

  /**
   * Fetch all mission memory and format as context for the agent prompt.
   */
  private async getMemoryContext(slug: string): Promise<string | null> {
    const MAX_MEMORY_CHARS = 4000;
    try {
      const memory = (await this.missions.getMemory(slug)) as Record<string, unknown> | null;
      if (!memory || Object.keys(memory).length === 0) return null;

      const lines: string[] = [];
      let totalChars = 0;
      for (const [key, value] of Object.entries(memory)) {
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
        const line = `  ${key}: ${valueStr}`;
        if (totalChars + line.length > MAX_MEMORY_CHARS) {
          lines.push(`  ... (${Object.keys(memory).length - lines.length} more keys truncated)`);
          break;
        }
        lines.push(line);
        totalChars += line.length;
      }

      return `Mission Memory:\n${lines.join('\n')}`;
    } catch {
      return null;
    }
  }

  private async storeTranscript(slug: string, msg: WsMissionCallCompleted): Promise<void> {
    if (!msg.step_id || msg.transcript.length === 0) return;

    try {
      await this.missions.saveMemory(slug, `transcript_${msg.step_id}`, {
        conversation_id: msg.conversation_id,
        duration_sec: msg.duration_sec,
        reason: msg.reason,
        messages: msg.transcript,
        stored_at: new Date().toISOString(),
      });
      this.logger.info(`[MissionEvent] Transcript stored for ${slug}/${msg.step_id}`);
    } catch (err) {
      this.logger.warn?.(`[MissionEvent] Failed to store transcript: ${err}`);
    }
  }
}
