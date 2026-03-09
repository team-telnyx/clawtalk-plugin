/**
 * ClawTalk SDK — public API surface.
 *
 * Usage:
 *   import { ClawTalkClient, ApiError } from './lib/clawtalk-sdk/index.js';
 */

export type { ClawTalkClientConfig } from './client.js';
export { ClawTalkClient } from './client.js';
export type { Endpoint, HttpMethod } from './endpoints.js';
export {
  ENDPOINTS,
  IMPLEMENTED_ENDPOINTS,
  READ_ENDPOINTS,
  resolve,
  UNIMPLEMENTED_ENDPOINTS,
} from './endpoints.js';
export { ApiError } from './errors.js';
export type { DoctorCheckResult } from './namespaces/doctor.js';

// Re-export all API types
export type {
  ApprovalResponse,
  ApprovalStatusResponse,
  AssignPhoneParams,
  AssistantConnectionResponse,
  AssistantFilter,
  AssistantListResponse,
  AssistantResponse,
  AssistantTool,
  CallEndResponse,
  CallResponse,
  CallStatusResponse,
  Conversation,
  ConversationsResponse,
  CreateApprovalParams,
  CreateAssistantParams,
  CreateMissionParams,
  CreatePlanStepInput,
  InitiateCallParams,
  InsightsResponse,
  LinkedAgentRecord,
  LinkedAgentsResponse,
  ListMessagesParams,
  LogMissionEventParams,
  MessagesListResponse,
  MissionDetailResponse,
  MissionEventListResponse,
  MissionEventResponse,
  MissionListResponse,
  MissionResponse,
  PaginationMeta,
  PhoneNumber,
  PhoneResponse,
  PlanResponse,
  PlanStepResponse,
  RunListResponse,
  RunResponse,
  RunUpdateParams,
  ScheduleCallParams,
  ScheduledEventDetailResponse,
  ScheduledEventResponse,
  ScheduleSmsParams,
  SendSmsParams,
  SmsMessage,
  SmsResponse,
  UpdateStepParams,
  UserMeResponse,
} from './types.js';
