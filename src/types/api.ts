/**
 * ClawTalk REST API request/response types.
 *
 * Every endpoint the ApiClient calls gets typed request params and response.
 * Matches the /v1/* endpoints on the ClawTalk server.
 */

// ── Common ────────────────────────────────────────────────────

export interface PaginationParams {
  readonly page?: number;
  readonly pageSize?: number;
}

export interface PaginatedResponse<T> {
  readonly data: T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

// ── User ──────────────────────────────────────────────────────

export interface UserMeResponse {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly tier: string;
  readonly phone_number: string | null;
  readonly created_at: string;
}

// ── Calls ─────────────────────────────────────────────────────

export interface InitiateCallParams {
  readonly to?: string;
  readonly greeting?: string;
  readonly purpose?: string;
}

export interface CallResponse {
  readonly call_id: string;
  readonly status: string;
  readonly direction: 'inbound' | 'outbound';
  readonly from: string;
  readonly to: string;
}

export interface CallStatusResponse {
  readonly call_id: string;
  readonly status: 'ringing' | 'answered' | 'ended' | 'failed';
  readonly duration?: number;
  readonly transcript?: string;
  readonly reason?: string;
}

// ── SMS ───────────────────────────────────────────────────────

export interface SendSmsParams {
  readonly to: string;
  readonly message: string;
  readonly media_urls?: string[];
}

export interface SmsResponse {
  readonly message_id: string;
  readonly from: string;
  readonly to: string;
  readonly status: string;
}

export interface ListMessagesParams extends PaginationParams {
  readonly contact?: string;
  readonly direction?: 'inbound' | 'outbound';
  readonly limit?: number;
}

export interface SmsMessage {
  readonly message_id: string;
  readonly from: string;
  readonly to: string;
  readonly body: string;
  readonly direction: 'inbound' | 'outbound';
  readonly status: string;
  readonly created_at: string;
  readonly media_urls?: string[];
}

export interface MessagesListResponse {
  readonly messages: SmsMessage[];
  readonly total: number;
}

export interface Conversation {
  readonly contact: string;
  readonly last_message: string;
  readonly last_message_at: string;
  readonly unread_count: number;
}

export interface ConversationsResponse {
  readonly conversations: Conversation[];
}

// ── Approvals ─────────────────────────────────────────────────

export interface CreateApprovalParams {
  readonly action: string;
  readonly details?: string;
  readonly biometric?: boolean;
  readonly timeout?: number;
}

export interface ApprovalResponse {
  readonly request_id: string;
  readonly status: 'pending' | 'approved' | 'denied' | 'timeout' | 'no_devices' | 'no_devices_reached';
}

export interface ApprovalStatusResponse {
  readonly request_id: string;
  readonly status: 'pending' | 'approved' | 'denied' | 'timeout' | 'no_devices' | 'no_devices_reached';
  readonly responded_at?: string;
}

// ── Assistants ────────────────────────────────────────────────

export interface CreateAssistantParams {
  readonly name: string;
  readonly instructions: string;
  readonly greeting?: string;
  readonly voice?: string;
  readonly model?: string;
  readonly io_screening?: boolean;
  readonly tools?: AssistantTool[];
}

export interface AssistantTool {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface AssistantResponse {
  readonly id: string;
  readonly name: string;
  readonly instructions: string;
  readonly greeting: string | null;
  readonly voice: string | null;
  readonly model: string | null;
  readonly connection_id: string | null;
  readonly created_at: string;
}

export interface AssistantFilter {
  readonly name?: string;
}

export interface AssistantListResponse {
  readonly assistants: AssistantResponse[];
}

// ── Phone Numbers ─────────────────────────────────────────────

export interface PhoneNumber {
  readonly id: string;
  readonly phone_number: string;
  readonly connection_id: string | null;
  readonly hd_voice: boolean;
  readonly status: string;
}

export interface PhoneResponse {
  readonly id: string;
  readonly phone_number: string;
  readonly hd_voice: boolean;
}

// ── Scheduled Events ──────────────────────────────────────────

export interface ScheduleCallParams {
  readonly assistant_id: string;
  readonly to: string;
  readonly from: string;
  readonly scheduled_at: string;
  readonly mission_id?: string;
  readonly run_id?: string;
}

export interface ScheduleSmsParams {
  readonly assistant_id: string;
  readonly to: string;
  readonly from: string;
  readonly scheduled_at: string;
  readonly message: string;
  readonly mission_id?: string;
  readonly run_id?: string;
}

export interface ScheduledEventResponse {
  readonly id: string;
  readonly type: 'call' | 'sms';
  readonly status: string;
  readonly scheduled_at: string;
}

export interface ScheduledEventDetailResponse extends ScheduledEventResponse {
  readonly assistant_id: string;
  readonly to: string;
  readonly from: string;
  readonly call_id?: string;
  readonly call_status?: string;
  readonly call_duration?: number;
  readonly conversation_id?: string;
  readonly completed_at?: string;
}

// ── Insights ──────────────────────────────────────────────────

export interface InsightsResponse {
  readonly conversation_id: string;
  readonly summary: string;
  readonly sentiment: string;
  readonly key_topics: string[];
  readonly action_items: string[];
}

// ── Linked Agents ─────────────────────────────────────────────

export interface LinkedAgentsResponse {
  readonly agents: Array<{
    readonly agent_id: string;
    readonly linked_at: string;
  }>;
}
