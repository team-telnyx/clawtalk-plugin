/**
 * BotConfigTool — clawtalk_bot_config: Read, update bot configuration, or browse voices.
 */

import { Type } from '@sinclair/typebox';
import type { ClawTalkClient } from '../lib/clawtalk-sdk/index.js';
import type { Voice } from '../lib/clawtalk-sdk/types.js';
import type { Logger } from '../types/plugin.js';
import { ToolError } from '../utils/errors.js';

// ── Schema ──────────────────────────────────────────────────

export const BotConfigToolSchema = Type.Object({
  action: Type.Union([Type.Literal('get'), Type.Literal('update'), Type.Literal('list_voices')]),
  agent_name: Type.Optional(Type.String({ description: 'Bot name (e.g. Daisy)' })),
  bot_role: Type.Optional(Type.String({ description: 'Bot role (e.g. live phone voice for Smokies Motels)' })),
  custom_instructions: Type.Optional(
    Type.String({ description: 'Custom behaviour instructions, business rules, pricing, etc.' }),
  ),
  greeting: Type.Optional(Type.String({ description: 'Greeting spoken when a call connects' })),
  voice_preference: Type.Optional(Type.String({ description: 'Voice ID (e.g. Rime.ArcanaV3.astra)' })),
  // list_voices filters
  provider: Type.Optional(
    Type.String({
      description:
        'Voice provider. Required for list_voices (default: "rime"). Options: rime, minimax, telnyx, inworld, resemble, aws, azure',
    }),
  ),
  language: Type.Optional(Type.String({ description: 'Filter by language code (e.g. "en", "es", "fr-FR")' })),
  gender: Type.Optional(Type.String({ description: 'Filter by gender ("Male" or "Female")' })),
  accent: Type.Optional(Type.String({ description: 'Filter by accent (e.g. "British", "Southern American")' })),
  search: Type.Optional(Type.String({ description: 'Search voice name or label' })),
});

// ── Voice Cache ─────────────────────────────────────────────

interface CacheEntry {
  voices: Voice[];
  providers: string[];
  defaultVoice: string;
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const voiceCache = new Map<string, CacheEntry>();

// ── Helpers ──────────────────────────────────────────────────

function formatResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function truncate(str: string | null, max: number): string | null {
  if (!str) return null;
  return str.length > max ? `${str.slice(0, max - 1)}_` : str;
}

// ── Tool ─────────────────────────────────────────────────────

export class BotConfigTool {
  readonly name = 'clawtalk_bot_config';
  readonly label = 'ClawTalk Bot Config';
  readonly description =
    'Read or update the bot configuration (name, role, custom instructions, greeting, voice). Use action "get" to read current config, "update" to change fields, "list_voices" to browse available voices by provider.';
  readonly parameters = BotConfigToolSchema;

  private readonly client: ClawTalkClient;
  private readonly logger: Logger;

  constructor(params: { client: ClawTalkClient; logger: Logger }) {
    this.client = params.client;
    this.logger = params.logger;
  }

  async execute(_toolCallId: string, raw: Record<string, unknown>) {
    const { action } = raw as { action: string };

    if (action === 'get') {
      return this.handleGet();
    }

    if (action === 'update') {
      return this.handleUpdate(raw);
    }

    if (action === 'list_voices') {
      return this.handleListVoices(raw);
    }

    throw new ToolError('clawtalk_bot_config', `Unknown action: ${action}`);
  }

  private async handleGet() {
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

  private async handleUpdate(raw: Record<string, unknown>) {
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

  private async handleListVoices(raw: Record<string, unknown>) {
    const provider = (raw.provider as string) || 'rime';
    const language = raw.language as string | undefined;
    const gender = raw.gender as string | undefined;
    const accent = raw.accent as string | undefined;
    const search = raw.search as string | undefined;

    this.logger.info(`Listing voices for provider: ${provider}`);

    try {
      // Check cache
      const cached = voiceCache.get(provider);
      let voices: Voice[];
      let defaultVoice: string;
      let allProviders: string[];

      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        voices = cached.voices;
        defaultVoice = cached.defaultVoice;
        allProviders = cached.providers;
      } else {
        const result = await this.client.voices.list(provider);
        voices = result.voices;
        defaultVoice = result.default_voice;
        allProviders = result.providers;
        voiceCache.set(provider, {
          voices,
          providers: allProviders,
          defaultVoice,
          fetchedAt: Date.now(),
        });
      }

      // Apply client-side filters
      let filtered = voices;

      if (language) {
        const lang = language.toLowerCase();
        filtered = filtered.filter((v) => v.language.toLowerCase().startsWith(lang));
      }

      if (gender) {
        const g = gender.toLowerCase();
        filtered = filtered.filter((v) => v.gender?.toLowerCase() === g);
      }

      if (accent) {
        const a = accent.toLowerCase();
        filtered = filtered.filter((v) => v.accent?.toLowerCase().includes(a));
      }

      if (search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(
          (v) =>
            v.name.toLowerCase().includes(s) ||
            v.id.toLowerCase().includes(s) ||
            (v.label?.toLowerCase().includes(s) ?? false),
        );
      }

      const totalMatching = filtered.length;
      const capped = filtered.slice(0, 20);

      return formatResult({
        default_voice: defaultVoice,
        provider,
        providers: allProviders,
        total_matching: totalMatching,
        showing: capped.length,
        voices: capped.map((v) => ({
          id: v.id,
          name: v.name,
          provider: v.provider,
          language: v.language,
          gender: v.gender,
          label: truncate(v.label, 80),
        })),
      });
    } catch (err) {
      throw ToolError.fromError('clawtalk_bot_config', err);
    }
  }
}
