import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionService, slugify } from '../../src/services/MissionService.js';
import type { ClawTalkClient } from '../../src/lib/clawtalk-sdk/index.js';
import type { Logger } from '../../src/types/plugin.js';

// ── Helpers ───────────────────────────────────────────────────

function logger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function mockClient(overrides: Record<string, unknown> = {}): ClawTalkClient {
  return {
    missions: {
      create: vi.fn().mockResolvedValue({ id: 'mis_1' }),
      get: vi.fn(),
      list: vi.fn(),
      runs: {
        create: vi.fn().mockResolvedValue({ run_id: 'run_1', mission_id: 'mis_1', status: 'pending' }),
        get: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      plans: {
        create: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue([]),
        updateStep: vi.fn().mockResolvedValue({ step_id: 's1', status: 'completed' }),
      },
      events: {
        log: vi.fn().mockResolvedValue({ id: 'evt_1', type: 'note', summary: 'test' }),
        list: vi.fn().mockResolvedValue([]),
      },
      agents: {
        link: vi.fn().mockResolvedValue(undefined),
        unlink: vi.fn(),
        list: vi.fn(),
      },
    },
    assistants: {
      create: vi.fn().mockResolvedValue({ id: 'ast_1', name: 'Test Agent' }),
      events: {
        schedule: vi.fn().mockResolvedValue({ id: 'sevt_1', channel: 'call', status: 'scheduled' }),
        get: vi.fn().mockResolvedValue({ id: 'sevt_1', status: 'scheduled' }),
        cancel: vi.fn().mockResolvedValue(undefined),
      },
    },
    numbers: {
      available: vi.fn().mockResolvedValue({ id: 'pn_1', phone_number: '+15551234567' }),
    },
    insights: {
      get: vi.fn().mockResolvedValue({ data: [] }),
    },
    ...overrides,
  } as unknown as ClawTalkClient;
}

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mission-test-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

// ── slugify ─────────────────────────────────────────────────

describe('slugify', () => {
  it('converts name to slug', () => {
    expect(slugify('Find Window Washers')).toBe('find-window-washers');
    expect(slugify('  Hello World!  ')).toBe('hello-world');
    expect(slugify('CamelCase123')).toBe('camelcase123');
    expect(slugify('foo---bar')).toBe('foo-bar');
  });
});

// ── State ───────────────────────────────────────────────────

describe('MissionService state', () => {
  it('returns empty state when no file exists', async () => {
    const svc = new MissionService({ client: mockClient(), logger: logger(), dataDir });
    const state = await svc.loadState();
    expect(state).toEqual({});
  });

  it('persists and loads state', async () => {
    const svc = new MissionService({ client: mockClient(), logger: logger(), dataDir });
    await svc.updateSlugState('test', { mission_id: 'mis_1', run_id: 'run_1' });
    const loaded = await svc.getSlugState('test');
    expect(loaded.mission_id).toBe('mis_1');
    expect(loaded.run_id).toBe('run_1');
  });

  it('removes slug state', async () => {
    const svc = new MissionService({ client: mockClient(), logger: logger(), dataDir });
    await svc.updateSlugState('test', { mission_id: 'mis_1' });
    await svc.removeSlugState('test');
    const loaded = await svc.getSlugState('test');
    expect(loaded).toEqual({});
  });
});

// ── Memory ──────────────────────────────────────────────────

describe('MissionService memory', () => {
  it('saves and retrieves memory by key', async () => {
    const svc = new MissionService({ client: mockClient(), logger: logger(), dataDir });
    await svc.saveMemory('test', 'contacts', [{ name: 'Alice' }]);
    const result = await svc.getMemory('test', 'contacts');
    expect(result).toEqual([{ name: 'Alice' }]);
  });

  it('returns all memory when no key specified', async () => {
    const svc = new MissionService({ client: mockClient(), logger: logger(), dataDir });
    await svc.saveMemory('test', 'a', 1);
    await svc.saveMemory('test', 'b', 2);
    const all = await svc.getMemory('test');
    expect(all).toEqual({ a: 1, b: 2 });
  });

  it('appends to list memory', async () => {
    const svc = new MissionService({ client: mockClient(), logger: logger(), dataDir });
    await svc.appendMemory('test', 'log', 'first');
    await svc.appendMemory('test', 'log', 'second');
    const result = await svc.getMemory('test', 'log');
    expect(result).toEqual(['first', 'second']);
  });

  it('converts non-array to single-element array before appending', async () => {
    const svc = new MissionService({ client: mockClient(), logger: logger(), dataDir });
    await svc.saveMemory('test', 'val', 'scalar');
    await svc.appendMemory('test', 'val', 'appended');
    const result = await svc.getMemory('test', 'val');
    expect(result).toEqual(['scalar', 'appended']);
  });
});

// ── initMission ─────────────────────────────────────────────

describe('MissionService.initMission', () => {
  it('creates mission, run, and plan', async () => {
    const client = mockClient();
    const svc = new MissionService({ client, logger: logger(), dataDir });

    const result = await svc.initMission({
      name: 'Test Mission',
      instructions: 'Do stuff',
      request: 'User wants stuff',
      steps: [{ title: 'Step One' }, { title: 'Step Two', description: 'Details' }],
    });

    expect(result.missionId).toBe('mis_1');
    expect(result.runId).toBe('run_1');
    expect(result.slug).toBe('test-mission');
    expect(result.resumed).toBe(false);

    expect(client.missions.create).toHaveBeenCalledWith({
      name: 'Test Mission',
      instructions: 'Do stuff',
    });
    expect(client.missions.runs.create).toHaveBeenCalledWith('mis_1', {
      original_request: 'User wants stuff',
    });
    expect(client.missions.plans.create).toHaveBeenCalledWith('mis_1', 'run_1', [
      { step_id: 'step-one', sequence: 1, title: 'Step One', description: undefined, status: 'pending' },
      { step_id: 'step-two', sequence: 2, title: 'Step Two', description: 'Details', status: 'pending' },
    ]);
    expect(client.missions.runs.update).toHaveBeenCalledWith('mis_1', 'run_1', { status: 'running' });
  });

  it('resumes existing mission from state', async () => {
    const client = mockClient();
    const svc = new MissionService({ client, logger: logger(), dataDir });

    // Seed state
    await svc.updateSlugState('test-mission', { mission_id: 'mis_old', run_id: 'run_old' });

    const result = await svc.initMission({
      name: 'Test Mission',
      instructions: 'ignored',
      request: 'ignored',
    });

    expect(result.missionId).toBe('mis_old');
    expect(result.runId).toBe('run_old');
    expect(result.resumed).toBe(true);
    expect(client.missions.create).not.toHaveBeenCalled();
  });

  it('skips plan creation when no steps', async () => {
    const client = mockClient();
    const svc = new MissionService({ client, logger: logger(), dataDir });

    await svc.initMission({ name: 'No Plan', instructions: 'x', request: 'y' });
    expect(client.missions.plans.create).not.toHaveBeenCalled();
  });
});

// ── setupVoiceAgent ─────────────────────────────────────────

describe('MissionService.setupVoiceAgent', () => {
  it('creates assistant, links agent, gets phone', async () => {
    const client = mockClient();
    const svc = new MissionService({ client, logger: logger(), dataDir });

    await svc.updateSlugState('my-mission', { mission_id: 'mis_1', run_id: 'run_1' });

    const result = await svc.setupVoiceAgent({
      missionSlug: 'my-mission',
      name: 'Agent',
      instructions: 'Be helpful',
    });

    expect(result.assistantId).toBe('ast_1');
    expect(result.phone).toBe('+15551234567');
    expect(client.missions.agents.link).toHaveBeenCalledWith('mis_1', 'run_1', 'ast_1');
  });

  it('resumes existing assistant from state', async () => {
    const client = mockClient();
    const svc = new MissionService({ client, logger: logger(), dataDir });

    await svc.updateSlugState('my-mission', {
      assistant_id: 'ast_existing',
      agent_phone: '+15559999999',
    });

    const result = await svc.setupVoiceAgent({
      missionSlug: 'my-mission',
      name: 'Agent',
      instructions: 'ignored',
    });

    expect(result.assistantId).toBe('ast_existing');
    expect(result.phone).toBe('+15559999999');
    expect(client.assistants.create).not.toHaveBeenCalled();
  });

  it('handles no available phone number gracefully', async () => {
    const client = mockClient({
      numbers: { available: vi.fn().mockRejectedValue(new Error('No numbers')) },
    });
    const svc = new MissionService({ client, logger: logger(), dataDir });

    await svc.updateSlugState('my-mission', { mission_id: 'mis_1', run_id: 'run_1' });

    const result = await svc.setupVoiceAgent({
      missionSlug: 'my-mission',
      name: 'Agent',
      instructions: 'test',
    });

    expect(result.assistantId).toBe('ast_1');
    expect(result.phone).toBeNull();
  });
});

// ── completeMission ─────────────────────────────────────────

describe('MissionService.completeMission', () => {
  it('completes mission and removes state', async () => {
    const client = mockClient();
    (client.missions.plans.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      { step_id: 's1', status: 'completed', sequence: 1 },
      { step_id: 's2', status: 'skipped', sequence: 2 },
    ]);
    const svc = new MissionService({ client, logger: logger(), dataDir });

    await svc.updateSlugState('done', { mission_id: 'mis_1', run_id: 'run_1' });

    await svc.completeMission({ missionSlug: 'done', summary: 'All done', payload: { score: 10 } });

    expect(client.missions.runs.update).toHaveBeenCalledWith('mis_1', 'run_1', {
      status: 'succeeded',
      result_summary: 'All done',
      result_payload: { score: 10 },
    });

    const afterState = await svc.getSlugState('done');
    expect(afterState).toEqual({});
  });

  it('throws if no active mission', async () => {
    const svc = new MissionService({ client: mockClient(), logger: logger(), dataDir });
    await expect(svc.completeMission({ missionSlug: 'nope', summary: 'x' })).rejects.toThrow('No active mission');
  });

  it('rejects completion when steps are still pending', async () => {
    const client = mockClient();
    (client.missions.plans.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      { step_id: 'call-alice', status: 'completed', sequence: 1 },
      { step_id: 'call-bob', status: 'pending', sequence: 2 },
      { step_id: 'send-report', status: 'in_progress', sequence: 3 },
    ]);
    const svc = new MissionService({ client, logger: logger(), dataDir });
    await svc.updateSlugState('m', { mission_id: 'mis_1', run_id: 'run_1' });

    await expect(svc.completeMission({ missionSlug: 'm', summary: 'done' })).rejects.toThrow(
      /2 step\(s\) still non-terminal/,
    );
    expect(client.missions.runs.update).not.toHaveBeenCalled();
  });

  it('allows completion when all steps are terminal (completed/failed/skipped)', async () => {
    const client = mockClient();
    (client.missions.plans.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      { step_id: 's1', status: 'completed', sequence: 1 },
      { step_id: 's2', status: 'failed', sequence: 2 },
      { step_id: 's3', status: 'skipped', sequence: 3 },
    ]);
    const svc = new MissionService({ client, logger: logger(), dataDir });
    await svc.updateSlugState('m', { mission_id: 'mis_1', run_id: 'run_1' });

    await svc.completeMission({ missionSlug: 'm', summary: 'mixed results' });
    expect(client.missions.runs.update).toHaveBeenCalled();
  });

  it('allows completion when mission has no plan steps', async () => {
    const client = mockClient();
    (client.missions.plans.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const svc = new MissionService({ client, logger: logger(), dataDir });
    await svc.updateSlugState('m', { mission_id: 'mis_1', run_id: 'run_1' });

    await svc.completeMission({ missionSlug: 'm', summary: 'no steps needed' });
    expect(client.missions.runs.update).toHaveBeenCalled();
  });
});

// ── scheduleCall / scheduleSms ───────────────────────────────

describe('MissionService scheduling', () => {
  it('schedules a call', async () => {
    const client = mockClient();
    const svc = new MissionService({ client, logger: logger(), dataDir });

    await svc.updateSlugState('m', {
      mission_id: 'mis_1',
      run_id: 'run_1',
      assistant_id: 'ast_1',
      agent_phone: '+15551234567',
    });

    const eventId = await svc.scheduleCall({
      missionSlug: 'm',
      to: '+353851234567',
      scheduledAt: '2026-04-01T10:00:00Z',
      stepId: 'call-step',
    });

    expect(eventId).toBe('sevt_1');
    expect(client.assistants.events.schedule).toHaveBeenCalledWith({
      assistant_id: 'ast_1',
      to: '+353851234567',
      from: '+15551234567',
      scheduled_at: '2026-04-01T10:00:00Z',
      mission_id: 'mis_1',
      run_id: 'run_1',
      step_id: 'call-step',
    });
  });

  it('schedules an SMS', async () => {
    const client = mockClient();
    const svc = new MissionService({ client, logger: logger(), dataDir });

    await svc.updateSlugState('m', {
      mission_id: 'mis_1',
      run_id: 'run_1',
      assistant_id: 'ast_1',
      agent_phone: '+15551234567',
    });

    const eventId = await svc.scheduleSms({
      missionSlug: 'm',
      to: '+353851234567',
      scheduledAt: '2026-04-01T10:00:00Z',
      textBody: 'Hello!',
    });

    expect(eventId).toBe('sevt_1');
    expect(client.assistants.events.schedule).toHaveBeenCalledWith({
      assistant_id: 'ast_1',
      to: '+353851234567',
      from: '+15551234567',
      scheduled_at: '2026-04-01T10:00:00Z',
      text_body: 'Hello!',
      mission_id: 'mis_1',
      run_id: 'run_1',
      step_id: undefined,
    });
  });

  it('throws if no assistant set up', async () => {
    const svc = new MissionService({ client: mockClient(), logger: logger(), dataDir });
    await svc.updateSlugState('m', { mission_id: 'mis_1', run_id: 'run_1' });

    await expect(
      svc.scheduleCall({ missionSlug: 'm', to: '+1234', scheduledAt: '2026-04-01T10:00:00Z' }),
    ).rejects.toThrow('no assistant/phone');
  });
});

// ── logEvent ────────────────────────────────────────────────

describe('MissionService.logEvent', () => {
  it('logs an event', async () => {
    const client = mockClient();
    const svc = new MissionService({ client, logger: logger(), dataDir });

    await svc.updateSlugState('m', { mission_id: 'mis_1', run_id: 'run_1' });

    const id = await svc.logEvent('m', { type: 'note', summary: 'Test note' });
    expect(id).toBe('evt_1');
    expect(client.missions.events.log).toHaveBeenCalledWith('mis_1', 'run_1', {
      type: 'note',
      summary: 'Test note',
      agent_id: 'openclaw-plugin',
      step_id: undefined,
      payload: undefined,
    });
  });
});

// ── Query helpers ───────────────────────────────────────────

// ── updatePlanStep state machine ────────────────────────────

describe('MissionService.updatePlanStep state machine', () => {
  it('allows pending → in_progress', async () => {
    const client = mockClient();
    (client.missions.plans.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      { step_id: 's1', status: 'pending', sequence: 1 },
    ]);
    const svc = new MissionService({ client, logger: logger(), dataDir });
    await svc.updateSlugState('m', { mission_id: 'mis_1', run_id: 'run_1' });

    await svc.updatePlanStep('m', 's1', 'in_progress');
    expect(client.missions.plans.updateStep).toHaveBeenCalledWith('mis_1', 'run_1', 's1', 'in_progress');
  });

  it('allows pending → skipped', async () => {
    const client = mockClient();
    (client.missions.plans.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      { step_id: 's1', status: 'pending', sequence: 1 },
    ]);
    const svc = new MissionService({ client, logger: logger(), dataDir });
    await svc.updateSlugState('m', { mission_id: 'mis_1', run_id: 'run_1' });

    await svc.updatePlanStep('m', 's1', 'skipped');
    expect(client.missions.plans.updateStep).toHaveBeenCalled();
  });

  it('allows in_progress → completed', async () => {
    const client = mockClient();
    (client.missions.plans.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      { step_id: 's1', status: 'in_progress', sequence: 1 },
    ]);
    const svc = new MissionService({ client, logger: logger(), dataDir });
    await svc.updateSlugState('m', { mission_id: 'mis_1', run_id: 'run_1' });

    await svc.updatePlanStep('m', 's1', 'completed');
    expect(client.missions.plans.updateStep).toHaveBeenCalled();
  });

  it('allows in_progress → failed', async () => {
    const client = mockClient();
    (client.missions.plans.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      { step_id: 's1', status: 'in_progress', sequence: 1 },
    ]);
    const svc = new MissionService({ client, logger: logger(), dataDir });
    await svc.updateSlugState('m', { mission_id: 'mis_1', run_id: 'run_1' });

    await svc.updatePlanStep('m', 's1', 'failed');
    expect(client.missions.plans.updateStep).toHaveBeenCalled();
  });

  it('rejects completed → pending (terminal cannot go backwards)', async () => {
    const client = mockClient();
    (client.missions.plans.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      { step_id: 's1', status: 'completed', sequence: 1 },
    ]);
    const svc = new MissionService({ client, logger: logger(), dataDir });
    await svc.updateSlugState('m', { mission_id: 'mis_1', run_id: 'run_1' });

    await expect(svc.updatePlanStep('m', 's1', 'pending')).rejects.toThrow(/terminal state.*completed/);
    expect(client.missions.plans.updateStep).not.toHaveBeenCalled();
  });

  it('rejects failed → in_progress (terminal cannot go backwards)', async () => {
    const client = mockClient();
    (client.missions.plans.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      { step_id: 's1', status: 'failed', sequence: 1 },
    ]);
    const svc = new MissionService({ client, logger: logger(), dataDir });
    await svc.updateSlugState('m', { mission_id: 'mis_1', run_id: 'run_1' });

    await expect(svc.updatePlanStep('m', 's1', 'in_progress')).rejects.toThrow(/terminal state.*failed/);
  });

  it('rejects skipped → pending (terminal cannot go backwards)', async () => {
    const client = mockClient();
    (client.missions.plans.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      { step_id: 's1', status: 'skipped', sequence: 1 },
    ]);
    const svc = new MissionService({ client, logger: logger(), dataDir });
    await svc.updateSlugState('m', { mission_id: 'mis_1', run_id: 'run_1' });

    await expect(svc.updatePlanStep('m', 's1', 'pending')).rejects.toThrow(/terminal state.*skipped/);
  });

  it('rejects pending → completed (must go through in_progress)', async () => {
    const client = mockClient();
    (client.missions.plans.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      { step_id: 's1', status: 'pending', sequence: 1 },
    ]);
    const svc = new MissionService({ client, logger: logger(), dataDir });
    await svc.updateSlugState('m', { mission_id: 'mis_1', run_id: 'run_1' });

    await expect(svc.updatePlanStep('m', 's1', 'completed')).rejects.toThrow(/Invalid transition.*pending.*completed/);
  });

  it('rejects pending → failed (must go through in_progress)', async () => {
    const client = mockClient();
    (client.missions.plans.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      { step_id: 's1', status: 'pending', sequence: 1 },
    ]);
    const svc = new MissionService({ client, logger: logger(), dataDir });
    await svc.updateSlugState('m', { mission_id: 'mis_1', run_id: 'run_1' });

    await expect(svc.updatePlanStep('m', 's1', 'failed')).rejects.toThrow(/Invalid transition.*pending.*failed/);
  });

  it('throws if step not found', async () => {
    const client = mockClient();
    (client.missions.plans.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      { step_id: 's1', status: 'pending', sequence: 1 },
    ]);
    const svc = new MissionService({ client, logger: logger(), dataDir });
    await svc.updateSlugState('m', { mission_id: 'mis_1', run_id: 'run_1' });

    await expect(svc.updatePlanStep('m', 'nonexistent', 'in_progress')).rejects.toThrow(/not found/);
  });
});

// ── Query helpers ───────────────────────────────────────────

describe('MissionService queries', () => {
  it('lists missions from state', async () => {
    const svc = new MissionService({ client: mockClient(), logger: logger(), dataDir });
    await svc.updateSlugState('a', { mission_name: 'A' });
    await svc.updateSlugState('b', { mission_name: 'B' });

    const list = await svc.listMissions();
    expect(list).toHaveLength(2);
    expect(list[0].slug).toBe('a');
    expect(list[1].slug).toBe('b');
  });

  it('gets plan for a mission', async () => {
    const client = mockClient();
    const svc = new MissionService({ client, logger: logger(), dataDir });
    await svc.updateSlugState('m', { mission_id: 'mis_1', run_id: 'run_1' });

    await svc.getPlan('m');
    expect(client.missions.plans.get).toHaveBeenCalledWith('mis_1', 'run_1');
  });

  it('cancels a scheduled event', async () => {
    const client = mockClient();
    const svc = new MissionService({ client, logger: logger(), dataDir });
    await svc.updateSlugState('m', { assistant_id: 'ast_1' });

    await svc.cancelScheduledEvent('m', 'sevt_1');
    expect(client.assistants.events.cancel).toHaveBeenCalledWith('ast_1', 'sevt_1');
  });
});
