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
  readonly text: string;
}

export interface WsClientRestart {
  readonly type: 'client_restart';
  readonly version: string;
  readonly reason: 'reconnect';
}

export type WsOutboundMessage =
  | WsAuthMessage
  | WsContextResponse
  | WsDeepToolProgress
  | WsDeepToolResult
  | WsCallResponse
  | WsWalkieResponse
  | WsClientRestart;

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
  readonly duration?: number;
  readonly reason?: string;
}

export interface WsDeepToolRequest extends WsEventBase {
  readonly event: 'deep_tool_request';
  readonly call_id: string;
  readonly request_id: string;
  readonly query: string;
  readonly context: Record<string, unknown>;
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

export type WsEvent =
  | WsContextRequest
  | WsCallStarted
  | WsCallEnded
  | WsDeepToolRequest
  | WsSmsReceived
  | WsApprovalResponded
  | WsWalkieRequest;

export type WsInboundMessage = WsAuthOk | WsAuthError | WsEvent;
