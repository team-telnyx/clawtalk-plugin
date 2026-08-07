/**
 * Tool registry — registers all agent tools with the OpenClaw plugin API.
 *
 * Phase 4: Call, SMS, Approve, Status
 * Phase 5: Mission lifecycle, Assistants, Insights
 */

import type { ResolvedClawTalkConfig } from '../config.js';
import type { ClawTalkClient } from '../lib/clawtalk-sdk/index.js';
import type { ApprovalManager } from '../services/ApprovalManager.js';
import type { MissionService } from '../services/MissionService.js';
import type { WebSocketService } from '../services/WebSocketService.js';
import type { Logger } from '../types/plugin.js';
import { ApproveTool } from './ApproveTool.js';
import { AssistantsTool } from './AssistantsTool.js';
import { BotConfigTool } from './BotConfigTool.js';
import { CallStatusTool, CallTool } from './CallTool.js';
import { InsightsTool } from './InsightsTool.js';
import {
  MissionCancelEventTool,
  MissionCompleteTool,
  MissionEventStatusTool,
  MissionGetPlanTool,
  MissionInitTool,
  MissionListTool,
  MissionLogEventTool,
  MissionMemoryTool,
  MissionScheduleTool,
  MissionSetupAgentTool,
  MissionUpdateStepTool,
} from './MissionTool.js';
import { SmsConversationsTool, SmsListTool, SmsTool } from './SmsTool.js';
import { StatusTool } from './StatusTool.js';

export const CLAWTALK_TOOL_NAMES = [
  'clawtalk_bot_config',
  'clawtalk_call',
  'clawtalk_call_status',
  'clawtalk_sms',
  'clawtalk_sms_list',
  'clawtalk_sms_conversations',
  'clawtalk_approve',
  'clawtalk_status',
  'clawtalk_mission_init',
  'clawtalk_mission_setup_agent',
  'clawtalk_mission_schedule',
  'clawtalk_mission_event_status',
  'clawtalk_mission_complete',
  'clawtalk_mission_update_step',
  'clawtalk_mission_log_event',
  'clawtalk_mission_memory',
  'clawtalk_mission_list',
  'clawtalk_mission_get_plan',
  'clawtalk_mission_cancel_event',
  'clawtalk_assistants',
  'clawtalk_insights',
] as const;

// ── Service container for tool construction ─────────────────

export interface ToolServices {
  readonly config: ResolvedClawTalkConfig;
  readonly client: ClawTalkClient;
  readonly approvalManager: ApprovalManager;
  readonly ws: WebSocketService;
  readonly missions: MissionService;
  readonly logger: Logger;
}

// ── Tool interface matching api.registerTool() shape ────────

export interface ClawTalkTool {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
  ): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    details: unknown;
  }>;
}

// ── Registry ────────────────────────────────────────────────

export function createTools(services: ToolServices): ClawTalkTool[] {
  const { config, client, approvalManager, ws, missions, logger } = services;
  const missionDeps = { missions, logger };

  return [
    // Phase 4
    new BotConfigTool({ client, logger }),
    new CallTool({ client, logger }),
    new CallStatusTool({ client, logger }),
    new SmsTool({ client, logger }),
    new SmsListTool({ client, logger }),
    new SmsConversationsTool({ client, logger }),
    new ApproveTool({ approvalManager, logger }),
    new StatusTool({ config, client, ws, logger }),

    // Phase 5: Mission lifecycle
    new MissionInitTool(missionDeps),
    new MissionSetupAgentTool(missionDeps),
    new MissionScheduleTool(missionDeps),
    new MissionEventStatusTool(missionDeps),
    new MissionCompleteTool(missionDeps),
    new MissionUpdateStepTool(missionDeps),
    new MissionLogEventTool(missionDeps),
    new MissionMemoryTool(missionDeps),
    new MissionListTool(missionDeps),
    new MissionGetPlanTool(missionDeps),
    new MissionCancelEventTool(missionDeps),

    // Phase 5: Standalone
    new AssistantsTool({ client, logger }),
    new InsightsTool({ client, logger }),
  ];
}

/**
 * Register all ClawTalk tools with the OpenClaw plugin API.
 */
export function registerTools(
  api: { registerTool: (tool: Record<string, unknown>) => void },
  services: ToolServices,
): void {
  const tools = createTools(services);

  for (const tool of tools) {
    api.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      execute: tool.execute.bind(tool),
    });
  }

  services.logger.info(`Registered ${tools.length} agent tools`);
}
