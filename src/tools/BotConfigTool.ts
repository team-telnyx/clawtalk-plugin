import { Type } from '@sinclair/typebox';
import type { ClawTalkClient } from '../lib/clawtalk-sdk/index.js';
import type { Logger } from '../types/plugin.js';
import { ToolError } from '../utils/errors.js';

export const BotConfigToolSchema = Type.Object({
  action: Type.Union([Type.Literal('get'), Type.Literal('update')]),
  agent_name: Type.Optional(Type.String({ description: 'Bot name (e.g. Daisy)' })),
  bot_role: Type.Optional(
    Type.String({ description: 'Bot role (e.g. live phone voice for Smokies Motels)' }),
  ),
  custom_instructions: Type.Optional(
    Type.String({ description: 'Custom behaviour instructions, business rules, pricing, etc.' }),
  ),
  greeting: Type.Optional(Type.String({ description: 'Greeting spoken when a call connects' })),
  voice_preference: Type.Optional(Type.String({ description: 'Voice ID (e.g. Rime.ArcanaV3.astra)' })),
});

function formatResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

export class BotConfigTool {
  private readonly client: ClawTalkClient;
  private readonly logger: Logger;

  readonly name = 'clawtalk_bot_config';
  readonly label = 'ClawTalk Bot Config';
  readonly description =
    'Read or update the bot configuration (name, role, custom instructions, greeting, voice). Use action "get" to read current config, "update" to change fields.';
  readonly parameters = BotConfigToolSchema;

  constructor(params: { client: ClawTalkClient; logger: Logger }) {
    this.client = params.client;
    this.logger = params.logger;
  }

  async execute(_toolCallId: string, raw: Record<string, unknown>) {
    const action = raw.action as string;

    if (action === 'get') {
      this.logger.info('Getting bot config');
      try {
        const me = await this.client.user.me();
        const config = {
          agent_name: me.agent_name ?? null,
          display_name: me.display_name ?? null,
          bot_role: me.bot_role ?? 'personal AI assistant',
          custom_instructions: me.custom_instructions ?? null,
          greeting: me.greeting ?? null,
          voice_preference: me.voice_preference ?? null,
        };
        return formatResult(config);
      } catch (err) {
        throw ToolError.fromError('clawtalk_bot_config', err);
      }
    }

    if (action === 'update') {
      this.logger.info('Updating bot config');
      const fields: Record<string, unknown> = {};
      for (const key of ['agent_name', 'bot_role', 'custom_instructions', 'greeting', 'voice_preference']) {
        if (raw[key] !== undefined) fields[key] = raw[key];
      }
      if (Object.keys(fields).length === 0) {
        throw new ToolError('clawtalk_bot_config', 'No fields provided for update');
      }
      try {
        await this.client.user.updateMe(fields);
        // Read back to confirm
        const me = await this.client.user.me();
        const config = {
          agent_name: me.agent_name ?? null,
          display_name: me.display_name ?? null,
          bot_role: me.bot_role ?? 'personal AI assistant',
          custom_instructions: me.custom_instructions ?? null,
          greeting: me.greeting ?? null,
          voice_preference: me.voice_preference ?? null,
          message: 'Bot config updated. Changes take effect on the next call.',
        };
        return formatResult(config);
      } catch (err) {
        throw ToolError.fromError('clawtalk_bot_config', err);
      }
    }

    throw new ToolError('clawtalk_bot_config', `Unknown action: ${action}`);
  }
}
