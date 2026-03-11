/**
 * Mission tools — thin wrappers around MissionService.
 *
 * 10 tools covering the full mission lifecycle:
 *   init, setup-agent, schedule, event-status, complete,
 *   update-step, log-event, memory, list, get-plan
 */

import { Type } from '@sinclair/typebox';
import type { MissionService } from '../services/MissionService.js';
import type { Logger } from '../types/plugin.js';
import { ToolError } from '../utils/errors.js';

// ── Helpers ─────────────────────────────────────────────────

const STEP_REMINDER =
  '💡 Reminder: Update step status as you progress (pending → in_progress → completed/failed/skipped). All steps must be terminal before completing the mission.';

function formatResult(payload: unknown, includeStepReminder = false) {
  const text = includeStepReminder
    ? `${JSON.stringify(payload, null, 2)}\n\n${STEP_REMINDER}`
    : JSON.stringify(payload, null, 2);
  return {
    content: [{ type: 'text' as const, text }],
    details: payload,
  };
}

function parseJsonParam(raw: string | undefined, fallback: unknown = undefined): unknown {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

interface ToolDeps {
  missions: MissionService;
  logger: Logger;
}

// ── Schemas ─────────────────────────────────────────────────

export const MissionInitSchema = Type.Object({
  name: Type.String({ description: 'Mission name (used to generate slug for state tracking)' }),
  instructions: Type.String({ description: 'Mission instructions for the AI agent' }),
  request: Type.String({ description: 'Original user request that triggered this mission' }),
  steps: Type.Optional(
    Type.String({
      description: 'JSON array of plan steps, e.g. [{"title":"Call Alice","description":"Ask about quote"}]',
    }),
  ),
});

export const MissionSetupAgentSchema = Type.Object({
  slug: Type.String({ description: 'Mission slug (returned from mission_init)' }),
  name: Type.String({ description: 'Assistant name' }),
  instructions: Type.String({ description: 'Voice agent instructions' }),
  greeting: Type.Optional(Type.String({ description: 'Greeting spoken when call connects. Default: empty' })),
  voice: Type.Optional(Type.String({ description: 'Voice model. Default: Rime.ArcanaV3.astra' })),
  model: Type.Optional(Type.String({ description: 'LLM model. Default: openai/gpt-4o' })),
});

export const MissionScheduleSchema = Type.Object({
  slug: Type.String({ description: 'Mission slug' }),
  channel: Type.Union([Type.Literal('call'), Type.Literal('sms')], { description: 'Event type: call or sms' }),
  to: Type.String({ description: 'Target phone number (E.164)' }),
  scheduledAt: Type.String({ description: 'ISO 8601 datetime for the event' }),
  textBody: Type.Optional(Type.String({ description: 'SMS text body (required for sms channel)' })),
  stepId: Type.Optional(Type.String({ description: 'Plan step ID to link (auto-syncs status on completion)' })),
});

export const MissionEventStatusSchema = Type.Object({
  slug: Type.String({ description: 'Mission slug' }),
  eventId: Type.String({ description: 'Scheduled event ID' }),
});

export const MissionCompleteSchema = Type.Object({
  slug: Type.String({ description: 'Mission slug' }),
  summary: Type.String({ description: 'Result summary' }),
  payload: Type.Optional(Type.String({ description: 'JSON string of result payload' })),
});

export const MissionUpdateStepSchema = Type.Object({
  slug: Type.String({ description: 'Mission slug' }),
  stepId: Type.String({ description: 'Plan step ID' }),
  status: Type.Union(
    [
      Type.Literal('pending'),
      Type.Literal('in_progress'),
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('skipped'),
    ],
    { description: 'New step status' },
  ),
});

export const MissionLogEventSchema = Type.Object({
  slug: Type.String({ description: 'Mission slug' }),
  type: Type.String({ description: 'Event type (e.g. note, step_completed, error)' }),
  summary: Type.String({ description: 'Event summary' }),
  stepId: Type.Optional(Type.String({ description: 'Related plan step ID' })),
  payload: Type.Optional(Type.String({ description: 'JSON string of event payload' })),
});

export const MissionMemorySchema = Type.Object({
  action: Type.Union([Type.Literal('save'), Type.Literal('append'), Type.Literal('get')], {
    description: 'Memory action',
  }),
  slug: Type.String({ description: 'Mission slug' }),
  key: Type.String({ description: 'Memory key' }),
  value: Type.Optional(Type.String({ description: 'JSON value (for save/append)' })),
});

export const MissionListSchema = Type.Object({});

export const MissionGetPlanSchema = Type.Object({
  slug: Type.String({ description: 'Mission slug' }),
});

export const MissionCancelEventSchema = Type.Object({
  slug: Type.String({ description: 'Mission slug' }),
  eventId: Type.String({ description: 'Scheduled event ID to cancel' }),
});

// ── Tool Classes ────────────────────────────────────────────

export class MissionInitTool {
  readonly name = 'clawtalk_mission_init';
  readonly label = 'ClawTalk Mission Init';
  readonly description =
    'Initialize a new mission with run and optional plan. Resumes existing mission if slug already exists in state.';
  readonly parameters = MissionInitSchema;

  private readonly missions: MissionService;

  constructor(deps: ToolDeps) {
    this.missions = deps.missions;
  }

  async execute(_toolCallId: string, raw: Record<string, unknown>) {
    try {
      const steps = parseJsonParam(raw.steps as string | undefined, undefined) as
        | Array<{ title: string; description?: string }>
        | undefined;

      const result = await this.missions.initMission({
        name: raw.name as string,
        instructions: raw.instructions as string,
        request: raw.request as string,
        steps,
      });

      return formatResult({
        missionId: result.missionId,
        runId: result.runId,
        slug: result.slug,
        resumed: result.resumed,
        message: result.resumed
          ? `Resumed existing mission '${result.slug}'`
          : `Created mission '${result.slug}' with run ${result.runId}`,
      }, true);
    } catch (err) {
      throw ToolError.fromError('clawtalk_mission_init', err);
    }
  }
}

export class MissionSetupAgentTool {
  readonly name = 'clawtalk_mission_setup_agent';
  readonly label = 'ClawTalk Mission Setup Agent';
  readonly description = 'Create a voice assistant, assign a phone number, and link to the mission run. Idempotent.';
  readonly parameters = MissionSetupAgentSchema;

  private readonly missions: MissionService;

  constructor(deps: ToolDeps) {
    this.missions = deps.missions;
  }

  async execute(_toolCallId: string, raw: Record<string, unknown>) {
    try {
      const result = await this.missions.setupVoiceAgent({
        missionSlug: raw.slug as string,
        name: raw.name as string,
        instructions: raw.instructions as string,
        greeting: raw.greeting as string | undefined,
        voice: raw.voice as string | undefined,
        model: raw.model as string | undefined,
      });

      return formatResult({
        assistantId: result.assistantId,
        phone: result.phone,
        message: result.phone
          ? `Agent ${result.assistantId} ready with phone ${result.phone}`
          : `Agent ${result.assistantId} created but no phone number available`,
      });
    } catch (err) {
      throw ToolError.fromError('clawtalk_mission_setup_agent', err);
    }
  }
}

export class MissionScheduleTool {
  readonly name = 'clawtalk_mission_schedule';
  readonly label = 'ClawTalk Mission Schedule';
  readonly description = 'Schedule a call or SMS for a mission. Uses assistant and phone from mission state.';
  readonly parameters = MissionScheduleSchema;

  private readonly missions: MissionService;

  constructor(deps: ToolDeps) {
    this.missions = deps.missions;
  }

  async execute(_toolCallId: string, raw: Record<string, unknown>) {
    try {
      const channel = raw.channel as 'call' | 'sms';
      const slug = raw.slug as string;
      let eventId: string;

      if (channel === 'sms') {
        eventId = await this.missions.scheduleSms({
          missionSlug: slug,
          to: raw.to as string,
          scheduledAt: raw.scheduledAt as string,
          textBody: raw.textBody as string,
          stepId: raw.stepId as string | undefined,
        });
      } else {
        eventId = await this.missions.scheduleCall({
          missionSlug: slug,
          to: raw.to as string,
          scheduledAt: raw.scheduledAt as string,
          stepId: raw.stepId as string | undefined,
        });
      }

      return formatResult({
        eventId,
        channel,
        scheduledAt: raw.scheduledAt,
        message: `Scheduled ${channel} event ${eventId} for ${raw.scheduledAt}`,
      }, true);
    } catch (err) {
      throw ToolError.fromError('clawtalk_mission_schedule', err);
    }
  }
}

export class MissionEventStatusTool {
  readonly name = 'clawtalk_mission_event_status';
  readonly label = 'ClawTalk Mission Event Status';
  readonly description = 'Check status of a scheduled call or SMS event.';
  readonly parameters = MissionEventStatusSchema;

  private readonly missions: MissionService;

  constructor(deps: ToolDeps) {
    this.missions = deps.missions;
  }

  async execute(_toolCallId: string, raw: Record<string, unknown>) {
    try {
      const event = await this.missions.getScheduledEvent(raw.slug as string, raw.eventId as string);

      return formatResult({
        eventId: event.id,
        channel: event.channel,
        status: event.status,
        callStatus: event.call_status,
        conversationId: event.conversation_id,
        message: `Event ${event.id}: ${event.status}${event.call_status ? ` (call: ${event.call_status})` : ''}`,
      });
    } catch (err) {
      throw ToolError.fromError('clawtalk_mission_event_status', err);
    }
  }
}

export class MissionCompleteTool {
  readonly name = 'clawtalk_mission_complete';
  readonly label = 'ClawTalk Mission Complete';
  readonly description = 'Complete a mission: mark run as succeeded and clean up local state.';
  readonly parameters = MissionCompleteSchema;

  private readonly missions: MissionService;

  constructor(deps: ToolDeps) {
    this.missions = deps.missions;
  }

  async execute(_toolCallId: string, raw: Record<string, unknown>) {
    try {
      await this.missions.completeMission({
        missionSlug: raw.slug as string,
        summary: raw.summary as string,
        payload: parseJsonParam(raw.payload as string | undefined) as Record<string, unknown> | undefined,
      });

      return formatResult({ message: `Mission '${raw.slug}' completed successfully` });
    } catch (err) {
      throw ToolError.fromError('clawtalk_mission_complete', err);
    }
  }
}

export class MissionUpdateStepTool {
  readonly name = 'clawtalk_mission_update_step';
  readonly label = 'ClawTalk Mission Update Step';
  readonly description = 'Update a plan step status (pending, in_progress, completed, failed, skipped).';
  readonly parameters = MissionUpdateStepSchema;

  private readonly missions: MissionService;

  constructor(deps: ToolDeps) {
    this.missions = deps.missions;
  }

  async execute(_toolCallId: string, raw: Record<string, unknown>) {
    try {
      await this.missions.updatePlanStep(raw.slug as string, raw.stepId as string, raw.status as string);
      return formatResult({ message: `Step '${raw.stepId}' updated to '${raw.status}'` });
    } catch (err) {
      throw ToolError.fromError('clawtalk_mission_update_step', err);
    }
  }
}

export class MissionLogEventTool {
  readonly name = 'clawtalk_mission_log_event';
  readonly label = 'ClawTalk Mission Log Event';
  readonly description = 'Log an event to a mission run (e.g. note, step_completed, error).';
  readonly parameters = MissionLogEventSchema;

  private readonly missions: MissionService;

  constructor(deps: ToolDeps) {
    this.missions = deps.missions;
  }

  async execute(_toolCallId: string, raw: Record<string, unknown>) {
    try {
      const id = await this.missions.logEvent(raw.slug as string, {
        type: raw.type as string,
        summary: raw.summary as string,
        stepId: raw.stepId as string | undefined,
        payload: parseJsonParam(raw.payload as string | undefined) as Record<string, unknown> | undefined,
      });
      return formatResult({ eventId: id, message: `Logged event: ${raw.summary}` }, true);
    } catch (err) {
      throw ToolError.fromError('clawtalk_mission_log_event', err);
    }
  }
}

export class MissionMemoryTool {
  readonly name = 'clawtalk_mission_memory';
  readonly label = 'ClawTalk Mission Memory';
  readonly description = 'Save, append, or retrieve mission memory (persistent key-value store per mission slug).';
  readonly parameters = MissionMemorySchema;

  private readonly missions: MissionService;

  constructor(deps: ToolDeps) {
    this.missions = deps.missions;
  }

  async execute(_toolCallId: string, raw: Record<string, unknown>) {
    const action = raw.action as 'save' | 'append' | 'get';
    const slug = raw.slug as string;
    const key = raw.key as string;

    try {
      if (action === 'get') {
        const data = await this.missions.getMemory(slug, key);
        return formatResult({
          data,
          message: data !== undefined ? `Memory '${key}' retrieved` : `No memory '${key}' found`,
        });
      }

      const value = parseJsonParam(raw.value as string | undefined, raw.value);

      if (action === 'append') {
        const count = await this.missions.appendMemory(slug, key, value);
        return formatResult({ message: `Appended to '${key}' (now ${count} items)` });
      }

      await this.missions.saveMemory(slug, key, value);
      return formatResult({ message: `Saved memory '${key}'` });
    } catch (err) {
      throw ToolError.fromError('clawtalk_mission_memory', err);
    }
  }
}

export class MissionListTool {
  readonly name = 'clawtalk_mission_list';
  readonly label = 'ClawTalk Mission List';
  readonly description = 'List all active missions from local state.';
  readonly parameters = MissionListSchema;

  private readonly missions: MissionService;

  constructor(deps: ToolDeps) {
    this.missions = deps.missions;
  }

  async execute(_toolCallId: string, _raw: Record<string, unknown>) {
    try {
      const list = await this.missions.listMissions();
      return formatResult({
        missions: list.map((m) => ({
          slug: m.slug,
          missionName: m.state.mission_name,
          missionId: m.state.mission_id,
        })),
        message: list.length ? `${list.length} active mission(s)` : 'No active missions',
      });
    } catch (err) {
      throw ToolError.fromError('clawtalk_mission_list', err);
    }
  }
}

export class MissionGetPlanTool {
  readonly name = 'clawtalk_mission_get_plan';
  readonly label = 'ClawTalk Mission Get Plan';
  readonly description = 'Get plan steps for a mission from the server.';
  readonly parameters = MissionGetPlanSchema;

  private readonly missions: MissionService;

  constructor(deps: ToolDeps) {
    this.missions = deps.missions;
  }

  async execute(_toolCallId: string, raw: Record<string, unknown>) {
    try {
      const steps = await this.missions.getPlan(raw.slug as string);
      return formatResult({ steps, message: `${steps.length} plan step(s)` });
    } catch (err) {
      throw ToolError.fromError('clawtalk_mission_get_plan', err);
    }
  }
}

export class MissionCancelEventTool {
  readonly name = 'clawtalk_mission_cancel_event';
  readonly label = 'ClawTalk Mission Cancel Event';
  readonly description = 'Cancel a scheduled call or SMS event.';
  readonly parameters = MissionCancelEventSchema;

  private readonly missions: MissionService;

  constructor(deps: ToolDeps) {
    this.missions = deps.missions;
  }

  async execute(_toolCallId: string, raw: Record<string, unknown>) {
    try {
      await this.missions.cancelScheduledEvent(raw.slug as string, raw.eventId as string);
      return formatResult({ message: `Cancelled event ${raw.eventId}` });
    } catch (err) {
      throw ToolError.fromError('clawtalk_mission_cancel_event', err);
    }
  }
}
