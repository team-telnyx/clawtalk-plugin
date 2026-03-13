import { ENDPOINTS, resolve } from '../endpoints.js';
import type {
  CreateMissionParams,
  CreatePlanStepInput,
  LinkedAgentsResponse,
  LogMissionEventParams,
  MissionDetailResponse,
  MissionEventListResponse,
  MissionEventResponse,
  MissionEventsAggregateResponse,
  MissionListResponse,
  MissionResponse,
  PlanStepResponse,
  RunListResponse,
  RunResponse,
  RunUpdateParams,
} from '../types.js';
import type { RequestFn } from './calls.js';

// ── Sub-namespaces ──────────────────────────────────────────

class RunsNamespace {
  constructor(private readonly request: RequestFn) {}

  async create(missionId: string, input: Record<string, unknown>): Promise<RunResponse> {
    const result = await this.request<{ data?: RunResponse }>(
      'POST',
      resolve(ENDPOINTS.createRun.path, { missionId }),
      { input },
    );
    return result.data ?? (result as unknown as RunResponse);
  }

  async get(missionId: string, runId: string): Promise<RunResponse> {
    const result = await this.request<{ data?: RunResponse }>(
      'GET',
      resolve(ENDPOINTS.getRun.path, { missionId, runId }),
    );
    return result.data ?? (result as unknown as RunResponse);
  }

  async update(missionId: string, runId: string, updates: RunUpdateParams): Promise<void> {
    await this.request<unknown>('PATCH', resolve(ENDPOINTS.updateRun.path, { missionId, runId }), updates);
  }

  async list(missionId: string): Promise<RunResponse[]> {
    const result = await this.request<RunListResponse>('GET', resolve(ENDPOINTS.listRuns.path, { missionId }));
    return result.data ?? [];
  }
}

class PlansNamespace {
  constructor(private readonly request: RequestFn) {}

  async create(missionId: string, runId: string, steps: CreatePlanStepInput[]): Promise<PlanStepResponse[]> {
    const result = await this.request<{ data?: PlanStepResponse[] }>(
      'POST',
      resolve(ENDPOINTS.createPlan.path, { missionId, runId }),
      { steps },
    );
    return result.data ?? [];
  }

  async get(missionId: string, runId: string): Promise<PlanStepResponse[]> {
    const result = await this.request<{ data?: PlanStepResponse[] }>(
      'GET',
      resolve(ENDPOINTS.getPlan.path, { missionId, runId }),
    );
    return result.data ?? [];
  }

  async updateStep(missionId: string, runId: string, stepId: string, status: string): Promise<PlanStepResponse> {
    const result = await this.request<{ data?: PlanStepResponse }>(
      'PATCH',
      resolve(ENDPOINTS.updateStep.path, { missionId, runId, stepId }),
      { status },
    );
    return result.data ?? (result as unknown as PlanStepResponse);
  }
}

class MissionEventsNamespace {
  constructor(private readonly request: RequestFn) {}

  async log(missionId: string, runId: string, event: LogMissionEventParams): Promise<MissionEventResponse> {
    const result = await this.request<{ data?: MissionEventResponse }>(
      'POST',
      resolve(ENDPOINTS.logEvent.path, { missionId, runId }),
      event,
    );
    return result.data ?? (result as unknown as MissionEventResponse);
  }

  async list(missionId: string, runId: string): Promise<MissionEventResponse[]> {
    const result = await this.request<MissionEventListResponse>(
      'GET',
      resolve(ENDPOINTS.listEvents.path, { missionId, runId }),
    );
    return result.data ?? [];
  }

  async aggregate(missionId: string): Promise<MissionEventsAggregateResponse> {
    return this.request<MissionEventsAggregateResponse>('GET', resolve(ENDPOINTS.getMissionEvents.path, { missionId }));
  }
}

class AgentsNamespace {
  constructor(private readonly request: RequestFn) {}

  async link(missionId: string, runId: string, agentId: string): Promise<void> {
    await this.request<unknown>('POST', resolve(ENDPOINTS.linkAgent.path, { missionId, runId }), {
      telnyx_agent_id: agentId,
    });
  }

  async unlink(missionId: string, runId: string, agentId: string): Promise<void> {
    await this.request<void>('DELETE', resolve(ENDPOINTS.unlinkAgent.path, { missionId, runId, agentId }));
  }

  async list(missionId: string, runId: string): Promise<LinkedAgentsResponse> {
    return this.request<LinkedAgentsResponse>('GET', resolve(ENDPOINTS.listLinkedAgents.path, { missionId, runId }));
  }
}

// ── Main namespace ──────────────────────────────────────────

export class MissionsNamespace {
  readonly runs: RunsNamespace;
  readonly plans: PlansNamespace;
  readonly events: MissionEventsNamespace;
  readonly agents: AgentsNamespace;

  constructor(private readonly request: RequestFn) {
    this.runs = new RunsNamespace(request);
    this.plans = new PlansNamespace(request);
    this.events = new MissionEventsNamespace(request);
    this.agents = new AgentsNamespace(request);
  }

  async create(params: CreateMissionParams): Promise<MissionResponse> {
    const result = await this.request<{ mission?: MissionResponse; data?: MissionResponse }>(
      'POST',
      ENDPOINTS.createMission.path,
      params,
    );
    return result.mission ?? result.data ?? (result as unknown as MissionResponse);
  }

  async get(missionId: string): Promise<MissionResponse> {
    const result = await this.request<MissionDetailResponse>('GET', resolve(ENDPOINTS.getMission.path, { missionId }));
    return result.mission ?? (result as unknown as MissionResponse);
  }

  async list(pageSize = 20): Promise<MissionResponse[]> {
    const result = await this.request<MissionListResponse>(
      'GET',
      `${ENDPOINTS.listMissions.path}?page[size]=${pageSize}`,
    );
    return result.missions ?? [];
  }
}
