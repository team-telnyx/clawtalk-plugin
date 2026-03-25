/**
 * ClawTalk server endpoint map — single source of truth.
 *
 * Every endpoint the SDK can call is defined here. ClawTalkClient namespaces
 * reference these paths, and integration tests iterate over them to verify reachability.
 *
 * Path params use `:paramName` notation. At runtime, resolve() interpolates
 * the actual values.
 *
 * Source: clawd-talk/server/src/index.js + routes/*.js
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface Endpoint {
  readonly method: HttpMethod;
  readonly path: string;
  /** Which SDK method uses this endpoint, or null if not yet implemented */
  readonly sdkMethod: string | null;
  /** Whether this is a write operation (creates/modifies data) */
  readonly write: boolean;
}

/**
 * All ClawTalk server endpoints used by the plugin.
 *
 * Server route file → mount point:
 *   user.js          → /v1
 *   calls.js         → /v1/calls
 *   messages.js      → /v1/messages
 *   approvals.js     → /v1/approvals
 *   missions.js      → /v1/missions
 *   assistants.js    → /v1/assistants
 *   numbers.js       → /v1/numbers
 *   conversations.js → /v1/conversations
 */
export const ENDPOINTS = {
  // ── User (/v1 + user.js) ────────────────────────────────
  getMe: { method: 'GET', path: '/v1/me', sdkMethod: 'getMe', write: false },
  updateMe: { method: 'PATCH', path: '/v1/me', sdkMethod: 'updateMe', write: true },

  // ── Voices (/v1 + user.js) ───────────────────────────────
  listVoices: { method: 'GET', path: '/v1/voices', sdkMethod: 'listVoices', write: false },

  // ── Calls (/v1/calls + calls.js) ────────────────────────
  initiateCall: { method: 'POST', path: '/v1/calls', sdkMethod: 'initiateCall', write: true },
  getCallStatus: { method: 'GET', path: '/v1/calls/:callId', sdkMethod: 'getCallStatus', write: false },
  endCall: { method: 'POST', path: '/v1/calls/:callId/end', sdkMethod: 'endCall', write: true },

  // ── SMS (/v1/messages + messages.js) ────────────────────
  sendSms: { method: 'POST', path: '/v1/messages/send', sdkMethod: 'sendSms', write: true },
  listMessages: { method: 'GET', path: '/v1/messages', sdkMethod: 'listMessages', write: false },
  listConversations: {
    method: 'GET',
    path: '/v1/messages/conversations',
    sdkMethod: 'listConversations',
    write: false,
  },

  // ── Approvals (/v1/approvals + approvals.js) ────────────
  createApproval: { method: 'POST', path: '/v1/approvals', sdkMethod: 'createApproval', write: true },
  getApprovalStatus: {
    method: 'GET',
    path: '/v1/approvals/:requestId',
    sdkMethod: 'getApprovalStatus',
    write: false,
  },

  // ── Missions (/v1/missions + missions.js) ───────────────
  createMission: { method: 'POST', path: '/v1/missions', sdkMethod: 'createMission', write: true },
  getMission: { method: 'GET', path: '/v1/missions/:missionId', sdkMethod: 'getMission', write: false },
  listMissions: { method: 'GET', path: '/v1/missions', sdkMethod: 'listMissions', write: false },
  cancelMission: { method: 'POST', path: '/v1/missions/:missionId/cancel', sdkMethod: null, write: true },

  // ── Runs (/v1/missions + missions.js) ───────────────────
  createRun: { method: 'POST', path: '/v1/missions/:missionId/runs', sdkMethod: 'createRun', write: true },
  getRun: { method: 'GET', path: '/v1/missions/:missionId/runs/:runId', sdkMethod: 'getRun', write: false },
  updateRun: { method: 'PATCH', path: '/v1/missions/:missionId/runs/:runId', sdkMethod: 'updateRun', write: true },
  listRuns: { method: 'GET', path: '/v1/missions/:missionId/runs', sdkMethod: 'listRuns', write: false },

  // ── Plans (/v1/missions + missions.js) ──────────────────
  createPlan: {
    method: 'POST',
    path: '/v1/missions/:missionId/runs/:runId/plan',
    sdkMethod: 'createPlan',
    write: true,
  },
  getPlan: { method: 'GET', path: '/v1/missions/:missionId/runs/:runId/plan', sdkMethod: 'getPlan', write: false },
  updateStep: {
    method: 'PATCH',
    path: '/v1/missions/:missionId/runs/:runId/plan/steps/:stepId',
    sdkMethod: 'updateStep',
    write: true,
  },

  // ── Mission Events (/v1/missions + missions.js) ─────────
  logEvent: {
    method: 'POST',
    path: '/v1/missions/:missionId/runs/:runId/events',
    sdkMethod: 'logEvent',
    write: true,
  },
  listEvents: {
    method: 'GET',
    path: '/v1/missions/:missionId/runs/:runId/events',
    sdkMethod: 'listEvents',
    write: false,
  },
  getMissionEvents: { method: 'GET', path: '/v1/missions/:missionId/events', sdkMethod: null, write: false },

  // ── Linked Agents (/v1/missions + missions.js) ──────────
  linkAgent: {
    method: 'POST',
    path: '/v1/missions/:missionId/runs/:runId/agents',
    sdkMethod: 'linkAgent',
    write: true,
  },
  listLinkedAgents: {
    method: 'GET',
    path: '/v1/missions/:missionId/runs/:runId/agents',
    sdkMethod: 'listLinkedAgents',
    write: false,
  },
  unlinkAgent: {
    method: 'DELETE',
    path: '/v1/missions/:missionId/runs/:runId/agents/:agentId',
    sdkMethod: 'unlinkAgent',
    write: true,
  },

  // ── Insights (/v1/missions + missions.js) ───────────────
  getInsights: {
    method: 'GET',
    path: '/v1/missions/conversations/:conversationId/insights',
    sdkMethod: 'getInsights',
    write: false,
  },
  getRecording: { method: 'GET', path: '/v1/missions/recordings/:recordingId', sdkMethod: null, write: false },

  // ── Assistants (/v1/assistants + assistants.js) ─────────
  createAssistant: { method: 'POST', path: '/v1/assistants', sdkMethod: 'createAssistant', write: true },
  listAssistants: { method: 'GET', path: '/v1/assistants', sdkMethod: 'listAssistants', write: false },
  getAssistant: { method: 'GET', path: '/v1/assistants/:assistantId', sdkMethod: 'getAssistant', write: false },
  updateAssistant: {
    method: 'PATCH',
    path: '/v1/assistants/:assistantId',
    sdkMethod: 'updateAssistant',
    write: true,
  },
  deleteAssistant: { method: 'DELETE', path: '/v1/assistants/:assistantId', sdkMethod: null, write: true },
  getConnectionId: {
    method: 'GET',
    path: '/v1/assistants/:assistantId/connection-id',
    sdkMethod: 'getAssistantConnectionId',
    write: false,
  },
  assignPhone: {
    method: 'POST',
    path: '/v1/assistants/:assistantId/assign-phone',
    sdkMethod: 'assignPhone',
    write: true,
  },

  // ── Scheduled Events (/v1/assistants + assistants.js) ───
  scheduleEvent: {
    method: 'POST',
    path: '/v1/assistants/:assistantId/events',
    sdkMethod: 'scheduleCall',
    write: true,
  },
  listScheduledEvents: { method: 'GET', path: '/v1/assistants/:assistantId/events', sdkMethod: null, write: false },
  getScheduledEvent: {
    method: 'GET',
    path: '/v1/assistants/:assistantId/events/:eventId',
    sdkMethod: 'getScheduledEvent',
    write: false,
  },
  cancelScheduledEvent: {
    method: 'DELETE',
    path: '/v1/assistants/:assistantId/events/:eventId',
    sdkMethod: 'cancelScheduledEvent',
    write: true,
  },

  // ── Phone Numbers (/v1/numbers + numbers.js) ────────────
  getAvailablePhone: {
    method: 'GET',
    path: '/v1/numbers/account-phones/available',
    sdkMethod: 'getAvailablePhone',
    write: false,
  },
  assignPhoneNumber: {
    method: 'PATCH',
    path: '/v1/numbers/account-phones/:phoneId',
    sdkMethod: 'assignPhone',
    write: true,
  },
  listAccountPhones: { method: 'GET', path: '/v1/numbers/account-phones', sdkMethod: null, write: false },
  searchPhones: { method: 'GET', path: '/v1/numbers/search', sdkMethod: null, write: false },
  orderPhone: { method: 'POST', path: '/v1/numbers/order', sdkMethod: null, write: true },
  releasePhone: { method: 'POST', path: '/v1/numbers/release', sdkMethod: null, write: true },
  listMyPhones: { method: 'GET', path: '/v1/numbers/mine', sdkMethod: null, write: false },
  // ── Doctor (/v1/doctor) ──────────────────────────────────
  doctorCritical: { method: 'GET', path: '/v1/doctor/critical', sdkMethod: 'getDoctorCritical', write: false },
  doctorWarnings: { method: 'GET', path: '/v1/doctor/warnings', sdkMethod: 'getDoctorWarnings', write: false },
  doctorRecommended: {
    method: 'GET',
    path: '/v1/doctor/recommended',
    sdkMethod: 'getDoctorRecommended',
    write: false,
  },
  doctorInfra: { method: 'GET', path: '/v1/doctor/infra', sdkMethod: 'getDoctorInfra', write: false },
} as const satisfies Record<string, Endpoint>;

/**
 * Resolve a path template by replacing `:paramName` segments with actual values.
 *
 * Usage: `resolve(ENDPOINTS.getCallStatus.path, { callId: 'call_123' })`
 * → `/v1/calls/call_123`
 */
export function resolve(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:(\w+)/g, (_, key) => {
    const value = params[key];
    if (value === undefined) {
      throw new Error(`Missing path param ":${key}" for path "${path}"`);
    }
    return encodeURIComponent(value);
  });
}

/** Endpoints the SDK has methods for */
export const IMPLEMENTED_ENDPOINTS = Object.fromEntries(
  Object.entries(ENDPOINTS).filter(([, e]) => e.sdkMethod !== null),
) as Record<string, Endpoint>;

/** Endpoints on the server that the SDK does NOT yet wrap */
export const UNIMPLEMENTED_ENDPOINTS = Object.fromEntries(
  Object.entries(ENDPOINTS).filter(([, e]) => e.sdkMethod === null),
) as Record<string, Endpoint>;

/** Read-only endpoints safe for integration testing with fake IDs */
export const READ_ENDPOINTS = Object.fromEntries(Object.entries(ENDPOINTS).filter(([, e]) => !e.write)) as Record<
  string,
  Endpoint
>;
