/**
 * ClawTalk plugin configuration.
 *
 * The JSON Schema equivalent lives in openclaw.plugin.json (configSchema).
 * Keep both in sync when adding fields.
 */

export interface MissionsConfig {
  /** Enable mission tools. Default: true */
  readonly enabled?: boolean;
  /** Default TTS voice for mission assistants */
  readonly defaultVoice?: string;
  /** Default AI model for mission assistants */
  readonly defaultModel?: string;
  /** Mission observer — configurable via plugin config (openclaw.plugin.json configSchema) */
  readonly observer?: {
    /** Enable MissionObserver background checks. Configurable, default: true */
    readonly enabled?: boolean;
    /** How often the observer checks for running missions (ms). Configurable, default: 300000 (5m) */
    readonly intervalMs?: number;
    /** Minimum time between prompts for the same mission (ms). Configurable, default: 300000 (5m) */
    readonly cooldownMs?: number;
  };
}

export interface ClawTalkConfig {
  /** Whether the plugin is enabled */
  readonly enabled?: boolean;
  /** ClawTalk API key (required) */
  readonly apiKey: string;
  /** Server URL. Default: "https://clawdtalk.com" */
  readonly server?: string;
  /** User's name for voice greeting */
  readonly ownerName?: string;
  /** Agent's name for voice context */
  readonly agentName?: string;
  /** Custom greeting for inbound calls. Supports {ownerName} placeholder. */
  readonly greeting?: string;
  /** Gateway agent ID. Default: "main" */
  readonly agentId?: string;
  /** Connect WebSocket on startup. Default: true */
  readonly autoConnect?: boolean;
  /** Override default voice context prompt */
  readonly voiceContext?: string;
  /** Mission-specific configuration */
  readonly missions?: MissionsConfig;
}

/** Resolved config with defaults applied */
export interface ResolvedClawTalkConfig {
  readonly enabled: boolean;
  readonly apiKey: string;
  readonly server: string;
  readonly ownerName: string;
  readonly agentName: string;
  readonly greeting: string;
  readonly agentId: string;
  readonly autoConnect: boolean;
  readonly voiceContext: string | undefined;
  readonly missions: {
    readonly enabled: boolean;
    readonly defaultVoice: string | undefined;
    readonly defaultModel: string | undefined;
    readonly observer: {
      readonly enabled: boolean;
      readonly intervalMs: number;
      readonly cooldownMs: number;
    };
  };
}

const DEFAULT_SERVER = 'https://clawdtalk.com';
const DEFAULT_AGENT_ID = 'main';
const DEFAULT_AGENT_NAME = 'ClawTalk';
const DEFAULT_MISSION_OBSERVER_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MISSION_COOLDOWN_MS = 5 * 60 * 1000;

const DEFAULT_VOICE_CONTEXT = [
  'You are a voice assistant. Keep responses concise and conversational.',
  'Do not use markdown, bullet points, or formatting — this will be spoken aloud.',
  'Avoid lists. Use short, natural sentences.',
  'If you need to convey multiple points, use conversational transitions.',
].join(' ');

export function resolveConfig(raw: ClawTalkConfig): ResolvedClawTalkConfig {
  const ownerName = raw.ownerName ?? 'there';
  const agentName = raw.agentName ?? DEFAULT_AGENT_NAME;
  const defaultGreeting = `Hey ${ownerName}, what's up?`;
  const missionsEnabled = raw.missions?.enabled ?? true;

  return {
    enabled: raw.enabled ?? true,
    apiKey: raw.apiKey,
    server: raw.server ?? DEFAULT_SERVER,
    ownerName,
    agentName,
    greeting: raw.greeting?.replace('{ownerName}', ownerName) ?? defaultGreeting,
    agentId: raw.agentId ?? DEFAULT_AGENT_ID,
    autoConnect: raw.autoConnect ?? true,
    voiceContext: raw.voiceContext ?? DEFAULT_VOICE_CONTEXT,
    missions: {
      enabled: missionsEnabled,
      defaultVoice: raw.missions?.defaultVoice,
      defaultModel: raw.missions?.defaultModel,
      observer: {
        enabled: missionsEnabled && (raw.missions?.observer?.enabled ?? true),
        intervalMs: raw.missions?.observer?.intervalMs ?? DEFAULT_MISSION_OBSERVER_INTERVAL_MS,
        cooldownMs: raw.missions?.observer?.cooldownMs ?? DEFAULT_MISSION_COOLDOWN_MS,
      },
    },
  };
}
