/**
 * ClawTalk WebSocket wire protocol types.
 *
 * Outbound = client → server
 * Inbound  = server → client
 *
 * The server wraps all events in { type: 'event', event: '<name>', ...payload }.
 * Auth messages use { type: 'auth' | 'auth_ok' | 'auth_error' }.
 */

// ── Outbound Messages (Client → Server) ──────────────────────

export interface WsAuthMessage {
  readonly type: 'auth';
  readonly api_key: string;
  readonly client_version?: string;
  readonly owner_name?: string;
  readonly agent_name?: string;
}

export interface WsContextResponse {
  readonly type: 'context_response';
  readonly call_id: string;
  readonly context: {
    readonly memory: string;
    readonly system_prompt: string;
  };
}

export interface WsDeepToolProgress {
  readonly type: 'deep_tool_progress';
  readonly call_id: string;
  readonly request_id: string;
  readonly text: string;
}

export interface WsDeepToolResult {
  readonly type: 'deep_tool_result';
  readonly call_id: string;
  readonly request_id: string;
  readonly text: string;
}

export interface WsCallResponse {
  readonly type: 'response';
  readonly call_id: string;
  readonly text: string;
}

export interface WsWalkieResponse {
  readonly type: 'walkie_response';
  readonly request_id: string;
  readonly reply: string;
  readonly error?: string;
}

export interface WsClientRestart {
  readonly type: 'client_restart';
  readonly version: string;
  readonly reason: 'reconnect';
}

export interface WsLogsResponse {
  readonly type: 'logs_response';
  readonly request_id: string;
  readonly lines: string[];
  readonly error?: string;
}

export type WsOutboundMessage =
  | WsAuthMessage
  | WsContextResponse
  | WsDeepToolProgress
  | WsDeepToolResult
  | WsCallResponse
  | WsWalkieResponse
  | WsClientRestart
  | WsLogsResponse;

// ── Inbound Messages (Server → Client) ───────────────────────

export interface WsAuthOk {
  readonly type: 'auth_ok';
}

export interface WsAuthError {
  readonly type: 'auth_error';
  readonly message: string;
}

/** All events arrive wrapped: { type: 'event', event: '<name>', ...payload } */
interface WsEventBase {
  readonly type: 'event';
}

export interface WsContextRequest extends WsEventBase {
  readonly event: 'context_request';
  readonly call_id: string;
}

export interface WsCallStarted extends WsEventBase {
  readonly event: 'call.started';
  readonly call_id: string;
  readonly direction: 'inbound' | 'outbound';
}

export interface WsCallEnded extends WsEventBase {
  readonly event: 'call.ended';
  readonly call_id: string;
  readonly direction?: 'inbound' | 'outbound';
  readonly duration_seconds?: number;
  readonly reason?: string;
  readonly outcome?: 'voicemail' | 'voicemail_failed' | 'no_answer' | 'fax' | string;
  readonly to_number?: string;
  readonly purpose?: string;
  readonly greeting?: string;
  readonly voicemail_message?: string;
}

export interface WsDeepToolRequest extends WsEventBase {
  readonly event: 'deep_tool_request';
  readonly call_id: string;
  readonly request_id: string;
  readonly query: string;
  readonly call_control_id?: string;
  readonly urgency?: 'normal' | 'urgent';
  readonly context?: string;
}

export interface WsSmsReceived extends WsEventBase {
  readonly event: 'sms.received';
  readonly from: string;
  readonly body: string;
  readonly message_id: string;
}

export interface WsApprovalResponded extends WsEventBase {
  readonly event: 'approval.responded';
  readonly request_id: string;
  readonly decision: 'approved' | 'denied' | 'timeout' | 'no_devices' | 'no_devices_reached';
}

export interface WsWalkieRequest extends WsEventBase {
  readonly event: 'walkie_request';
  readonly request_id: string;
  readonly transcript: string;
  readonly session_key?: string;
}

// ── Mission Events (Server → Client) ─────────────────────────────

export interface WsMissionCallStarted extends WsEventBase {
  readonly event: 'mission.call_started';
  readonly mission_id: string;
  readonly step_id: string | null;
  readonly conversation_id: string | null;
  readonly from: string;
  readonly to: string;
}

export interface WsMissionCallCompleted extends WsEventBase {
  readonly event: 'mission.call_completed';
  readonly mission_id: string;
  readonly step_id: string | null;
  readonly conversation_id: string | null;
  readonly from: string;
  readonly to: string;
  readonly duration_sec: number | null;
  readonly reason: string | null;
  readonly transcript: Array<{ role: string; content: string; timestamp: string | null }>;
}

export interface WsMissionCallFailed extends WsEventBase {
  readonly event: 'mission.call_failed';
  readonly mission_id: string;
  readonly step_id: string | null;
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}

export interface WsMissionInsightsReady extends WsEventBase {
  readonly event: 'mission.insights_ready';
  readonly mission_id: string;
  readonly step_id: string | null;
  readonly conversation_id: string | null;
  readonly summary: string;
}

export interface WsMissionSmsDelivered extends WsEventBase {
  readonly event: 'mission.sms_delivered';
  readonly mission_id: string;
  readonly step_id: string | null;
  readonly from: string;
  readonly to: string;
  readonly status: string;
  readonly errors: string[];
}

export interface SmsThreadMessage {
  readonly direction: 'inbound' | 'outbound';
  readonly from: string;
  readonly to: string;
  readonly text: string;
  readonly timestamp: string;
}

export interface WsMissionSmsReceived extends WsEventBase {
  readonly event: 'mission.sms_received';
  readonly mission_id: string;
  readonly step_id: string | null;
  readonly from: string;
  readonly to: string;
  readonly text: string;
  readonly message_id: string;
  readonly thread_context?: SmsThreadMessage[];
}

export type WsMissionEvent =
  | WsMissionCallStarted
  | WsMissionCallCompleted
  | WsMissionCallFailed
  | WsMissionInsightsReady
  | WsMissionSmsDelivered
  | WsMissionSmsReceived;

export type WsEvent =
  | WsContextRequest
  | WsCallStarted
  | WsCallEnded
  | WsDeepToolRequest
  | WsSmsReceived
  | WsApprovalResponded
  | WsWalkieRequest
  | WsMissionEvent;

export interface WsRequestLogs {
  readonly type: 'request_logs';
  readonly request_id: string;
}

export type WsInboundMessage = WsAuthOk | WsAuthError | WsEvent | WsRequestLogs;
