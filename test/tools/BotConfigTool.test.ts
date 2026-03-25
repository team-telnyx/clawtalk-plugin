import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BotConfigTool } from '../../src/tools/BotConfigTool.js';
import type { ClawTalkClient } from '../../src/lib/clawtalk-sdk/index.js';
import type { Logger } from '../../src/types/plugin.js';

// ── Mocks ───────────────────────────────────────────────────

function createMockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

const mockUserData = {
  user_id: 'user_123',
  agent_name: 'PAL-01',
  display_name: 'Ciaran',
  bot_role: 'Personal assistant',
  custom_instructions: 'Be helpful.',
  greeting: 'Hey, what do you need?',
  voice_preference: 'Minimax.speech-2.8-turbo.English_Aussie_Bloke',
};

const mockVoices = [
  {
    id: 'Rime.ArcanaV3.astra',
    name: 'Astra',
    provider: 'rime',
    language: 'en-US',
    gender: 'Female',
    accent: 'American',
    label: 'Warm and friendly voice',
  },
  {
    id: 'Rime.ArcanaV3.kai',
    name: 'Kai',
    provider: 'rime',
    language: 'en-US',
    gender: 'Male',
    accent: 'American',
    label: 'Deep and calm voice',
  },
  {
    id: 'Rime.ArcanaV3.luna',
    name: 'Luna',
    provider: 'rime',
    language: 'en-GB',
    gender: 'Female',
    accent: 'British',
    label: 'Elegant British voice',
  },
  {
    id: 'Rime.ArcanaV3.connor',
    name: 'Connor',
    provider: 'rime',
    language: 'en-IE',
    gender: 'Male',
    accent: 'Irish',
    label: 'Friendly Irish voice',
  },
];

function createMockClient(overrides: Partial<{
  user: Record<string, unknown>;
  voices: Record<string, unknown>;
}> = {}): ClawTalkClient {
  return {
    user: {
      me: vi.fn().mockResolvedValue(mockUserData),
      updateMe: vi.fn().mockResolvedValue(mockUserData),
      ...overrides.user,
    },
    voices: {
      list: vi.fn().mockResolvedValue({
        voices: mockVoices,
        default_voice: 'Rime.ArcanaV3.astra',
        providers: ['aws', 'azure', 'minimax', 'resemble', 'rime', 'telnyx'],
      }),
      ...overrides.voices,
    },
  } as unknown as ClawTalkClient;
}

// ── BotConfigTool ───────────────────────────────────────────

describe('BotConfigTool', () => {
  let tool: BotConfigTool;
  let client: ClawTalkClient;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    client = createMockClient();
    tool = new BotConfigTool({ client, logger });
  });

  it('has correct metadata', () => {
    expect(tool.name).toBe('clawtalk_bot_config');
    expect(tool.label).toBe('ClawTalk Bot Config');
    expect(tool.description).toContain('Read or update');
  });

  // ── action: get ─────────────────────────────────────────

  describe('action: get', () => {
    it('returns bot config', async () => {
      const result = await tool.execute('tc_1', { action: 'get' });

      expect(client.user.me).toHaveBeenCalled();

      const details = result.details as Record<string, unknown>;
      expect(details.agent_name).toBe('PAL-01');
      expect(details.display_name).toBe('Ciaran');
      expect(details.bot_role).toBe('Personal assistant');
      expect(details.greeting).toBe('Hey, what do you need?');
      expect(details.voice_preference).toBe('Minimax.speech-2.8-turbo.English_Aussie_Bloke');
    });

    it('handles null fields gracefully', async () => {
      const sparseClient = createMockClient({
        user: {
          me: vi.fn().mockResolvedValue({ user_id: 'user_123' }),
        },
      });
      const sparseTool = new BotConfigTool({ client: sparseClient, logger });

      const result = await sparseTool.execute('tc_2', { action: 'get' });
      const details = result.details as Record<string, unknown>;

      expect(details.agent_name).toBeNull();
      expect(details.bot_role).toBe('personal AI assistant'); // default
    });

    it('throws on API error', async () => {
      const failClient = createMockClient({
        user: { me: vi.fn().mockRejectedValue(new Error('Unauthorized')) },
      });
      const failTool = new BotConfigTool({ client: failClient, logger });

      await expect(failTool.execute('tc_3', { action: 'get' })).rejects.toThrow('Unauthorized');
    });
  });

  // ── action: update ──────────────────────────────────────

  describe('action: update', () => {
    it('updates bot config with provided fields', async () => {
      const result = await tool.execute('tc_4', {
        action: 'update',
        greeting: 'Yo, what up?',
        voice_preference: 'Azure.en-IE-ConnorNeural',
      });

      expect(client.user.updateMe).toHaveBeenCalledWith({
        greeting: 'Yo, what up?',
        voice_preference: 'Azure.en-IE-ConnorNeural',
      });

      const details = result.details as Record<string, unknown>;
      expect(details.message).toBe('Bot config updated. Changes take effect on the next call.');
    });

    it('updates all supported fields', async () => {
      await tool.execute('tc_5', {
        action: 'update',
        agent_name: 'Daisy',
        bot_role: 'Receptionist',
        custom_instructions: 'Be polite.',
        greeting: 'Hello!',
        voice_preference: 'Rime.ArcanaV3.astra',
      });

      expect(client.user.updateMe).toHaveBeenCalledWith({
        agent_name: 'Daisy',
        bot_role: 'Receptionist',
        custom_instructions: 'Be polite.',
        greeting: 'Hello!',
        voice_preference: 'Rime.ArcanaV3.astra',
      });
    });

    it('throws when no fields provided', async () => {
      await expect(tool.execute('tc_6', { action: 'update' })).rejects.toThrow(
        'No fields provided for update',
      );
    });

    it('throws on API error', async () => {
      const failClient = createMockClient({
        user: { updateMe: vi.fn().mockRejectedValue(new Error('Bad request')) },
      });
      const failTool = new BotConfigTool({ client: failClient, logger });

      await expect(
        failTool.execute('tc_7', { action: 'update', greeting: 'Hi' }),
      ).rejects.toThrow('Bad request');
    });
  });

  // ── action: list_voices ─────────────────────────────────

  describe('action: list_voices', () => {
    it('lists voices for default provider (rime)', async () => {
      const result = await tool.execute('tc_8', { action: 'list_voices' });

      expect(client.voices.list).toHaveBeenCalledWith('rime');

      const details = result.details as Record<string, unknown>;
      expect(details.provider).toBe('rime');
      expect(details.default_voice).toBe('Rime.ArcanaV3.astra');
      expect(details.total_matching).toBe(4);
      expect(details.showing).toBe(4);
      expect(Array.isArray(details.voices)).toBe(true);
    });

    it('lists voices for specified provider', async () => {
      await tool.execute('tc_9', { action: 'list_voices', provider: 'minimax' });

      expect(client.voices.list).toHaveBeenCalledWith('minimax');
    });

    it('filters by language', async () => {
      const result = await tool.execute('tc_10', {
        action: 'list_voices',
        language: 'en-GB',
      });

      const details = result.details as Record<string, unknown>;
      expect(details.total_matching).toBe(1);

      const voices = details.voices as Array<{ name: string }>;
      expect(voices[0].name).toBe('Luna');
    });

    it('filters by language prefix', async () => {
      const result = await tool.execute('tc_11', {
        action: 'list_voices',
        language: 'en',
      });

      const details = result.details as Record<string, unknown>;
      expect(details.total_matching).toBe(4); // all are en-*
    });

    it('filters by gender', async () => {
      const result = await tool.execute('tc_12', {
        action: 'list_voices',
        gender: 'Male',
      });

      const details = result.details as Record<string, unknown>;
      expect(details.total_matching).toBe(2);

      const voices = details.voices as Array<{ name: string }>;
      expect(voices.map((v) => v.name)).toContain('Kai');
      expect(voices.map((v) => v.name)).toContain('Connor');
    });

    it('filters by accent', async () => {
      const result = await tool.execute('tc_13', {
        action: 'list_voices',
        accent: 'Irish',
      });

      const details = result.details as Record<string, unknown>;
      expect(details.total_matching).toBe(1);

      const voices = details.voices as Array<{ name: string }>;
      expect(voices[0].name).toBe('Connor');
    });

    it('filters by search term', async () => {
      const result = await tool.execute('tc_14', {
        action: 'list_voices',
        search: 'luna',
      });

      const details = result.details as Record<string, unknown>;
      expect(details.total_matching).toBe(1);

      const voices = details.voices as Array<{ name: string }>;
      expect(voices[0].name).toBe('Luna');
    });

    it('searches in label', async () => {
      const result = await tool.execute('tc_15', {
        action: 'list_voices',
        search: 'elegant',
      });

      const details = result.details as Record<string, unknown>;
      expect(details.total_matching).toBe(1);

      const voices = details.voices as Array<{ name: string }>;
      expect(voices[0].name).toBe('Luna');
    });

    it('combines multiple filters', async () => {
      const result = await tool.execute('tc_16', {
        action: 'list_voices',
        language: 'en',
        gender: 'Female',
        accent: 'British',
      });

      const details = result.details as Record<string, unknown>;
      expect(details.total_matching).toBe(1);

      const voices = details.voices as Array<{ name: string }>;
      expect(voices[0].name).toBe('Luna');
    });

    it('caps results at 20', async () => {
      // Create 30 voices — use unique provider to avoid cache
      const manyVoices = Array.from({ length: 30 }, (_, i) => ({
        id: `voice_${i}`,
        name: `Voice ${i}`,
        provider: 'test-many',
        language: 'en-US',
        gender: 'Female',
        accent: 'American',
        label: null,
      }));

      const manyClient = createMockClient({
        voices: {
          list: vi.fn().mockResolvedValue({
            voices: manyVoices,
            default_voice: 'voice_0',
            providers: ['test-many'],
          }),
        },
      });
      const manyTool = new BotConfigTool({ client: manyClient, logger });

      const result = await manyTool.execute('tc_17', { action: 'list_voices', provider: 'test-many' });

      const details = result.details as Record<string, unknown>;
      expect(details.total_matching).toBe(30);
      expect(details.showing).toBe(20);

      const voices = details.voices as Array<unknown>;
      expect(voices).toHaveLength(20);
    });

    it('truncates long labels', async () => {
      // Use unique provider to avoid cache
      const longLabelVoice = {
        id: 'voice_long',
        name: 'Long Voice',
        provider: 'test-long',
        language: 'en-US',
        gender: 'Female',
        accent: 'American',
        label: 'A'.repeat(100),
      };

      const longClient = createMockClient({
        voices: {
          list: vi.fn().mockResolvedValue({
            voices: [longLabelVoice],
            default_voice: 'voice_long',
            providers: ['test-long'],
          }),
        },
      });
      const longTool = new BotConfigTool({ client: longClient, logger });

      const result = await longTool.execute('tc_18', { action: 'list_voices', provider: 'test-long' });

      const details = result.details as Record<string, unknown>;
      const voices = details.voices as Array<{ label: string }>;

      expect(voices[0].label).toHaveLength(80);
      expect(voices[0].label.endsWith('_')).toBe(true);
    });

    it('returns providers list', async () => {
      const result = await tool.execute('tc_19', { action: 'list_voices' });

      const details = result.details as Record<string, unknown>;
      expect(details.providers).toEqual(['aws', 'azure', 'minimax', 'resemble', 'rime', 'telnyx']);
    });

    it('throws on API error', async () => {
      // Use unique provider to avoid cache
      const failClient = createMockClient({
        voices: { list: vi.fn().mockRejectedValue(new Error('Service unavailable')) },
      });
      const failTool = new BotConfigTool({ client: failClient, logger });

      await expect(
        failTool.execute('tc_20', { action: 'list_voices', provider: 'test-fail' }),
      ).rejects.toThrow('Service unavailable');
    });
  });

  // ── Unknown action ──────────────────────────────────────

  describe('unknown action', () => {
    it('throws on unknown action', async () => {
      await expect(
        tool.execute('tc_21', { action: 'delete' }),
      ).rejects.toThrow('Unknown action: delete');
    });
  });
});
