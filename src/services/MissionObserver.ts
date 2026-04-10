/**
 * MissionObserver — background mission lifecycle monitor.
 *
 * Runs on a fixed interval (default 5m) independent of chat turns.
 * Checks every running mission on each tick and sends full mission
 * context (mission detail + events as raw JSON) to a dedicated
 * mission session, letting the agent decide what action to take.
 *
 * The only gate: mission status === "running".
 * Cooldowns prevent spamming the same session on every tick.
 */

import type { Logger } from '../types/plugin.js';
import type { ICoreBridge } from './CoreBridge.js';
import type { MissionService } from './MissionService.js';

export interface MissionObserverConfig {
  readonly enabled: boolean;
  readonly intervalMs: number;
  /** Minimum time between prompts for the same mission (ms). */
  readonly cooldownMs: number;
}

export interface MissionObserverDeps {
  readonly missions: MissionService;
  readonly coreBridge: ICoreBridge;
  readonly logger: Logger;
  readonly config: MissionObserverConfig;
}

export class MissionObserver {
  private readonly missions: MissionService;
  private readonly coreBridge: ICoreBridge;
  private readonly logger: Logger;
  private readonly config: MissionObserverConfig;

  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly lastPromptAt = new Map<string, number>();

  constructor(deps: MissionObserverDeps) {
    this.missions = deps.missions;
    this.coreBridge = deps.coreBridge;
    this.logger = deps.logger;
    this.config = deps.config;
  }

  start(): void {
    if (!this.config.enabled) {
      this.logger.info('[MissionObserver] Disabled via config.');
      return;
    }
    if (this.interval) return;

    const tick = () => {
      this.check().catch((err) => {
        this.logger.warn?.(`[MissionObserver] Tick failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    };

    tick();
    this.interval = setInterval(tick, this.config.intervalMs);
    this.interval.unref?.();

    this.logger.info(`[MissionObserver] Started (${Math.round(this.config.intervalMs / 1000)}s interval).`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.logger.info('[MissionObserver] Stopped.');
    }
  }

  // ── Private ─────────────────────────────────────────────────

  private async check(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const runningMissions = await this.fetchRunningMissions();
      if (runningMissions.length === 0) {
        this.logger.info('[MissionObserver] No running missions found.');
        return;
      }
      this.logger.info(`[MissionObserver] Running missions: ${runningMissions.length}`);

      for (const mission of runningMissions) {
        const missionId = mission.id;
        const now = Date.now();
        const lastAt = this.lastPromptAt.get(missionId);

        if (lastAt && now - lastAt < this.config.cooldownMs) {
          const remaining = Math.ceil((this.config.cooldownMs - (now - lastAt)) / 1000);
          this.logger.info(
            `[MissionObserver] Skip ${mission.name} (${missionId}) — cooldown (${remaining}s remaining)`,
          );
          continue;
        }

        try {
          const [detail, events] = await Promise.all([
            this.fetchMissionDetail(missionId),
            this.fetchMissionEvents(missionId),
          ]);

          const sent = await this.sendMissionPrompt({
            missionId,
            name: mission.name,
            missionJson: JSON.stringify(detail, null, 2),
            eventsJson: JSON.stringify(events, null, 2),
          });

          if (sent) {
            this.lastPromptAt.set(missionId, now);
          }
        } catch (err) {
          this.logger.warn?.(
            `[MissionObserver] Failed to process mission ${missionId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async fetchRunningMissions(): Promise<Array<{ id: string; name: string }>> {
    try {
      const client = this.missions.getClient();
      const all = await client.missions.list(50);
      return all.filter((m) => m.status === 'running');
    } catch (err) {
      this.logger.warn?.(
        `[MissionObserver] Failed to fetch missions: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private async fetchMissionDetail(missionId: string): Promise<unknown> {
    const client = this.missions.getClient();
    return client.missions.get(missionId);
  }

  private async fetchMissionEvents(missionId: string): Promise<unknown> {
    const client = this.missions.getClient();
    return client.missions.events.aggregate(missionId);
  }

  private async sendMissionPrompt(params: {
    missionId: string;
    name: string;
    missionJson: string;
    eventsJson: string;
  }): Promise<boolean> {
    const sessionKey = `clawtalk:mission:${params.missionId}`;

    const prompt = [
      `[ClawTalk Mission Observer] Mission "${params.name}" (${params.missionId}) is running.`,
      '',
      'Mission data:',
      params.missionJson,
      '',
      'Events data:',
      params.eventsJson,
      '',
      'Review the mission status and take any action needed:',
      '- If a call was completed with a non-success status (busy, no-answer, etc), advance the plan and schedule the next step',
      '- If all plan steps are terminal, complete or fail the mission appropriately',
      '- If the mission appears stuck or stale with no pending events, consider failing it',
      '- Use `clawtalk_mission_memory` to retrieve any memories saved during the mission',
      '- If everything is proceeding normally, no action is needed',
    ].join('\n');

    try {
      this.logger.info(`[MissionObserver] Sending prompt to ${sessionKey}`);
      await this.coreBridge.runAgentTurn({
        sessionKey,
        prompt,
        timeoutMs: 60_000,
      });
      return true;
    } catch (err) {
      this.logger.warn?.(
        `[MissionObserver] Failed to send prompt for ${params.missionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
