/**
 * ClawTalk mission domain types.
 *
 * Missions represent multi-step AI workflows: create mission → create run →
 * create plan → schedule events → poll → complete.
 */

// ── Enums ─────────────────────────────────────────────────────

export const StepStatus = {
  Pending: 'pending',
  InProgress: 'in_progress',
  Completed: 'completed',
  Failed: 'failed',
  Skipped: 'skipped',
} as const;

export type StepStatus = (typeof StepStatus)[keyof typeof StepStatus];

export const EventType = {
  StepStarted: 'step_started',
  StepCompleted: 'step_completed',
  StepFailed: 'step_failed',
  CallScheduled: 'call_scheduled',
  CallCompleted: 'call_completed',
  SmsScheduled: 'sms_scheduled',
  SmsSent: 'sms_sent',
  AgentLinked: 'agent_linked',
  AgentUnlinked: 'agent_unlinked',
  Note: 'note',
  Error: 'error',
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

// ── Domain Types ──────────────────────────────────────────────

export interface Mission {
  readonly id: string;
  readonly name: string;
  readonly instructions: string;
  readonly status: 'active' | 'completed' | 'failed' | 'cancelled';
  readonly created_at: string;
}

export interface Run {
  readonly id: string;
  readonly mission_id: string;
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  readonly input: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
  readonly created_at: string;
  readonly completed_at?: string;
}

export interface PlanStep {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly status: StepStatus;
  readonly order: number;
}

export interface Plan {
  readonly steps: PlanStep[];
}

export interface MissionEvent {
  readonly id: string;
  readonly mission_id: string;
  readonly run_id: string;
  readonly type: EventType;
  readonly summary: string;
  readonly step_id?: string;
  readonly payload?: Record<string, unknown>;
  readonly created_at: string;
}

// ── State Management ──────────────────────────────────────────

/** Per-mission local state, persisted in .missions_state.json */
export interface MissionState {
  readonly slug: string;
  readonly missionId: string;
  readonly runId: string;
  readonly planSteps: PlanStep[];
  readonly assistants: Array<{
    readonly id: string;
    readonly name: string;
    readonly phone: string;
  }>;
  readonly createdAt: string;
}

/** Root state file shape */
export interface MissionsStateFile {
  readonly missions: Record<string, MissionState>;
}

// ── Service Method Params ─────────────────────────────────────

export interface InitMissionParams {
  readonly name: string;
  readonly instructions: string;
  readonly request: string;
  readonly steps?: Array<{
    readonly title: string;
    readonly description?: string;
  }>;
}

export interface InitMissionResult {
  readonly missionId: string;
  readonly runId: string;
  readonly slug: string;
  readonly steps: PlanStep[];
}

export interface SetupAgentParams {
  readonly name: string;
  readonly instructions: string;
  readonly greeting?: string;
  readonly voice?: string;
  readonly model?: string;
}

export interface SetupAgentResult {
  readonly assistantId: string;
  readonly phone: string;
  readonly connectionId: string;
}

export interface LogEventParams {
  readonly type: EventType;
  readonly summary: string;
  readonly step_id?: string;
  readonly payload?: Record<string, unknown>;
}

// ── Assistant Types (re-exported from api for convenience) ────

export type { AssistantResponse, InsightsResponse } from './api.js';
