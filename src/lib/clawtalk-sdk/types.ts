/**
 * ClawTalk REST API request/response types.
 *
 * Every endpoint the SDK calls gets typed request params and response.
 * Matches the /v1/* endpoints on the ClawTalk server.
 *
 * Source of truth: server code + live response captures (test/endpoint-shapes.md)
 * Last verified: 2026-03-09
 */

// ── Common ────────────────────────────────────────────────────

export interface PaginationMeta {
  readonly total_pages: number;
  readonly total_results: number;
  readonly page_number: number;
  readonly page_size: number;
}

// ── User ──────────────────────────────────────────────────────

/** GET /v1/me — full user profile */
export interface UserMeResponse {
  readonly user_id: string;
  readonly email: string | null;
  readonly clawdbot_instance_id: string | null;
  readonly phone: string | null;
  readonly phone_verified: boolean;
  readonly pin_required: boolean;
  readonly has_pin: boolean;
  readonly callback_url: string | null;
  readonly subscription_tier: string;
  readonly effective_tier: string;
  readonly effective_source: string;
  readonly effective_days_remaining: number | null;
  readonly subscription_status: string;
  readonly paranoid_mode: boolean;
  readonly agent_name?: string | null;
  readonly display_name?: string | null;
  readonly bot_role?: string | null;
  readonly custom_instructions?: string | null;
  readonly greeting?: string | null;
  readonly voice_preference?: string | null;
  readonly system_number: string | null;
  readonly dedicated_number: string | null;
  readonly totp_enabled: boolean;
  readonly created_at: string;
  readonly last_ws_connected_at: string | null;
  readonly pending_email: string | null;
  readonly email_change_sms_verified: boolean;
  readonly quota: {
    readonly daily_call_seconds_limit: number;
    readonly daily_calls_limit: number;
    readonly monthly_call_seconds_limit: number;
    readonly monthly_messages_limit: number;
    readonly monthly_missions_limit: number;
    readonly monthly_mission_events_limit: number;
    readonly max_call_duration_seconds: number;
  };
  readonly usage_today: {
    readonly call_seconds: number;
    readonly calls: number;
  };
  readonly usage_this_month: {
    readonly call_seconds: number;
    readonly mission_events: number;
  };
}

// ── Calls ─────────────────────────────────────────────────────

export interface InitiateCallParams {
  readonly to?: string;
  readonly greeting?: string;
  readonly purpose?: string;
}

/** POST /v1/calls → 202 */
export interface CallResponse {
  readonly call_id: string;
  readonly status: string;
  readonly direction: 'inbound' | 'outbound';
}

/** GET /v1/calls/:callId */
export interface CallStatusResponse {
  readonly call_id: string;
  readonly direction: string;
  readonly status: string;
  readonly started_at: string;
  readonly duration_seconds: number | null;
  readonly user_id: string;
}

/** POST /v1/calls/:callId/end */
export interface CallEndResponse {
  readonly call_id: string;
  readonly status: 'ending';
  readonly duration_seconds: number;
}

// ── SMS ───────────────────────────────────────────────────────

export interface SendSmsParams {
  readonly to: string;
  readonly message: string;
  readonly media_urls?: string[];
}

/** POST /v1/messages/send */
export interface SmsResponse {
  readonly id: string;
  readonly telnyx_message_id: string;
  readonly status: string;
  readonly from: string;
  readonly to: string;
}

export interface ListMessagesParams {
  readonly contact?: string;
  readonly direction?: 'inbound' | 'outbound';
  readonly page?: number;
  readonly limit?: number;
}

export interface SmsMessage {
  readonly id: string;
  readonly direction: 'inbound' | 'outbound';
  readonly from: string;
  readonly to: string;
  readonly body: string;
  readonly media_urls: string[] | null;
  readonly status: string;
  readonly type: string;
  readonly created_at: string;
  readonly delivered_at: string | null;
  readonly error: { readonly code: string; readonly message: string } | null;
}

/** GET /v1/messages */
export interface MessagesListResponse {
  readonly messages: SmsMessage[];
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly pages: number;
  };
}

export interface Conversation {
  readonly contact: string;
  readonly last_message: string;
  readonly last_message_at: string;
  readonly unread_count: number;
}

/** GET /v1/messages/conversations */
export interface ConversationsResponse {
  readonly conversations: Conversation[];
}

// ── Approvals ─────────────────────────────────────────────────

export interface CreateApprovalParams {
  readonly action: string;
  readonly details?: string;
  readonly require_biometric?: boolean;
  readonly expires_in?: number;
}

/** POST /v1/approvals → 201 */
export interface ApprovalResponse {
  readonly request_id: string;
  readonly status: string;
  readonly expires_at: string;
  readonly devices_notified: number;
  readonly devices_failed: number;
}

/** GET /v1/approvals/:requestId */
export interface ApprovalStatusResponse {
  readonly request_id: string;
  readonly action: string;
  readonly details: string | null;
  readonly require_biometric: boolean;
  readonly status: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly responded_at: string | null;
  readonly response: string | null;
  readonly biometric_verified: boolean | null;
}

// ── Assistants ────────────────────────────────────────────────

export interface CreateAssistantParams {
  readonly name: string;
  readonly instructions: string;
  readonly greeting?: string;
  readonly voice?: string;
  readonly model?: string;
  readonly description?: string;
  readonly enabled_features?: string[];
  readonly tools?: AssistantTool[];
  readonly extra_config?: Record<string, unknown>;
}

export interface AssistantTool {
  readonly type: string;
  readonly [key: string]: unknown;
}

/** DB record from mission_assistants table */
export interface AssistantResponse {
  readonly id: string;
  readonly user_id: string;
  readonly telnyx_assistant_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly model: string;
  readonly enabled_features: string[];
  readonly phone_number: string | null;
  readonly phone_number_id: string | null;
  readonly connection_id: string | null;
  readonly config: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AssistantFilter {
  readonly name?: string;
}

/** GET /v1/assistants */
export interface AssistantListResponse {
  readonly assistants: AssistantResponse[];
}

// ── Phone Numbers ─────────────────────────────────────────────

/** Shape from user_numbers table (account-phones endpoints) */
export interface PhoneNumber {
  readonly id: string;
  readonly phone_number: string;
  readonly status: string;
  readonly ordered_at: string;
}

/** GET /v1/numbers/account-phones/available → { phone: PhoneNumber } */
export interface PhoneResponse {
  readonly id: string;
  readonly phone_number: string;
  readonly status: string;
  readonly ordered_at: string;
}

// ── Scheduled Events ──────────────────────────────────────────

export interface ScheduleCallParams {
  readonly assistant_id: string;
  readonly to: string;
  readonly from: string;
  readonly scheduled_at: string;
  readonly mission_id?: string;
  readonly run_id?: string;
  readonly step_id?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ScheduleSmsParams {
  readonly assistant_id: string;
  readonly to: string;
  readonly from: string;
  readonly scheduled_at: string;
  readonly text_body: string;
  readonly mission_id?: string;
  readonly run_id?: string;
  readonly step_id?: string;
  readonly metadata?: Record<string, unknown>;
}

/** DB record from scheduled_events table (RETURNING *) */
export interface ScheduledEventResponse {
  readonly id: string;
  readonly user_id: string;
  readonly assistant_id: string;
  readonly telnyx_assistant_id: string;
  readonly telnyx_event_id: string | null;
  readonly channel: 'call' | 'sms';
  readonly to_number: string;
  readonly from_number: string;
  readonly scheduled_at: string;
  readonly text_body: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly status: string;
  readonly call_status: string | null;
  readonly conversation_id: string | null;
  readonly telnyx_mission_id: string | null;
  readonly telnyx_run_id: string | null;
  readonly step_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** GET /v1/assistants/:id/events/:eventId — same shape as create */
export type ScheduledEventDetailResponse = ScheduledEventResponse;

// ── Missions ──────────────────────────────────────────────────

export interface CreateMissionParams {
  readonly name: string;
  readonly instructions: string;
  readonly channel?: string;
  readonly metadata?: Record<string, unknown>;
}

/** DB record from missions table */
export interface MissionResponse {
  readonly id: string;
  readonly user_id: string;
  readonly telnyx_mission_id: string;
  readonly telnyx_run_id: string;
  readonly name: string;
  readonly instructions: string;
  readonly status: string;
  readonly channel: string;
  readonly target_count: number;
  readonly events_used: number;
  readonly assistant_id: string | null;
  readonly assistant_phone: string | null;
  readonly metadata: Record<string, unknown>;
  readonly result_summary: string | null;
  readonly result_payload: Record<string, unknown> | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** GET /v1/missions/:id — enriched with relations */
export interface MissionDetailResponse {
  readonly mission: MissionResponse & {
    readonly assistant: AssistantResponse | null;
    readonly linked_agents: LinkedAgentRecord[];
    readonly plan: { readonly steps: PlanStepResponse[] };
  };
}

/** GET /v1/missions — list with computed fields */
export interface MissionListResponse {
  readonly missions: Array<
    MissionResponse & {
      readonly computed_target_count: string;
      readonly computed_event_count: string;
      readonly computed_scheduled_count: string;
    }
  >;
}

// ── Runs (Telnyx-proxied) ─────────────────────────────────────

export interface CreateRunParams {
  readonly input: Record<string, unknown>;
}

/** Telnyx run record — primary key is run_id, NOT id */
export interface RunResponse {
  readonly run_id: string;
  readonly mission_id: string;
  readonly organization_id: string;
  readonly status: string;
  readonly input: Record<string, unknown>;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly result_summary: string | null;
  readonly result_payload: Record<string, unknown> | null;
  readonly error: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly updated_at: string;
}

export interface RunUpdateParams {
  readonly status?: string;
  readonly result_summary?: string;
  readonly result_payload?: Record<string, unknown>;
}

/** GET /v1/missions/:id/runs — includes pagination meta */
export interface RunListResponse {
  readonly data: RunResponse[];
  readonly meta: PaginationMeta;
}

// ── Plans (Telnyx-proxied) ────────────────────────────────────

/** Input for plan creation — Telnyx requires step_id + sequence */
export interface CreatePlanStepInput {
  readonly step_id: string;
  readonly sequence: number;
  readonly title?: string;
  readonly description?: string;
  readonly status?: string;
}

/** Telnyx plan step record */
export interface PlanStepResponse {
  readonly step_id: string;
  readonly sequence: number;
  readonly title?: string;
  readonly description?: string;
  readonly status: string;
}

/**
 * Plan response from Telnyx.
 * NOTE: GET /plan returns { data: PlanStepResponse[] } — data is an array, NOT { steps: [...] }
 */
export interface PlanResponse {
  readonly data: PlanStepResponse[];
}

export interface UpdateStepParams {
  readonly status: string;
}

// ── Events (Mission, Telnyx-proxied) ──────────────────────────

export interface LogMissionEventParams {
  readonly type: string;
  readonly summary: string;
  readonly agent_id?: string;
  readonly step_id?: string;
  readonly payload?: Record<string, unknown>;
}

export interface MissionEventResponse {
  readonly id: string;
  readonly type: string;
  readonly summary: string;
  readonly agent_id?: string;
  readonly step_id?: string;
  readonly payload?: Record<string, unknown>;
  readonly created_at: string;
}

/** GET /v1/missions/:id/runs/:id/events — includes pagination meta */
export interface MissionEventListResponse {
  readonly data: MissionEventResponse[];
  readonly meta: PaginationMeta;
}

/** GET /v1/missions/:id/events — aggregate mission event view used by portal */
export interface MissionEventsAggregateResponse {
  readonly telnyx_events?: MissionEventResponse[];
  readonly scheduled_events?: ScheduledEventResponse[];
  readonly local_events?: Array<{
    readonly id: string;
    readonly mission_id: string;
    readonly type: string;
    readonly status: string;
    readonly target_phone?: string | null;
    readonly step_id?: string | null;
  }>;
}

// ── Assistant Connection ──────────────────────────────────────

/** GET /v1/assistants/:id/connection-id */
export interface AssistantConnectionResponse {
  readonly connection_id: string;
}

// ── Phone Number Assignment ───────────────────────────────────

/** PATCH /v1/numbers/account-phones/:phoneId — body */
export interface AssignPhoneParams {
  readonly connection_id: string;
  readonly type?: string;
}

/** POST /v1/assistants/:id/assign-phone — body */
export interface AssistantAssignPhoneParams {
  readonly phone_number_id: string;
  readonly connection_id: string;
  readonly type?: string;
}

// ── Insights (Telnyx-proxied) ─────────────────────────────────

/**
 * GET /v1/missions/conversations/:conversationId/insights
 * This is a Telnyx proxy — exact shape depends on Telnyx response.
 * May return array or object; consumer should handle both.
 */
export interface InsightsResponse {
  readonly data?: Array<{
    readonly status: string;
    readonly conversation_insights?: Array<{
      readonly result: string;
    }>;
  }>;
}

// ── Linked Agents (Telnyx-proxied) ────────────────────────────

/** Single linked agent record */
export interface LinkedAgentRecord {
  readonly run_id: string;
  readonly telnyx_agent_id: string;
  readonly created_at: string;
}

/** GET /v1/missions/:id/runs/:id/agents → { data: [...] } */
export interface LinkedAgentsResponse {
  readonly data: LinkedAgentRecord[];
}
