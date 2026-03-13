/**
 * ClawTalk OpenClaw Plugin — entry point.
 *
 * Follows the voice-call plugin's lazy ensureRuntime() pattern:
 *   - Config parsed eagerly in register()
 *   - Full service graph built lazily on first use
 *   - Tools registered eagerly (they call ensureRuntime() internally)
 *   - Service start triggers runtime creation
 *
 * Phase 6: TALK-50
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { registerClawTalkCli } from './cli.js';
import { type ClawTalkConfig, type ResolvedClawTalkConfig, resolveConfig } from './config.js';
import { ClawTalkClient } from './lib/clawtalk-sdk/index.js';
import { createHealthHandler, createWebhookHandler } from './routes/index.js';
import { ApprovalManager } from './services/ApprovalManager.js';
import { CallHandler } from './services/CallHandler.js';
import { CoreBridge, type CoreConfig } from './services/CoreBridge.js';
import { DeepToolHandler } from './services/DeepToolHandler.js';
import { DoctorService } from './services/DoctorService.js';
import { MissionEventHandler } from './services/MissionEventHandler.js';
import { MissionService } from './services/MissionService.js';
import { SmsHandler } from './services/SmsHandler.js';
import { VoiceService } from './services/VoiceService.js';
import { WalkieHandler } from './services/WalkieHandler.js';
import { readPackageVersion, WebSocketService } from './services/WebSocketService.js';
import { createTools, type ToolServices } from './tools/index.js';
import { WsLogger } from './utils/ws-logger.js';

// ── Module-level singleton ──────────────────────────────────
// Prevents duplicate WS connections when register() is called multiple times
// (e.g. embedded agent sessions re-register plugins in the same process).
let globalRuntime: ClawTalkRuntime | null = null;
let globalRuntimePromise: Promise<ClawTalkRuntime> | null = null;

// ── Runtime type ────────────────────────────────────────────

interface ClawTalkRuntime {
  readonly client: ClawTalkClient;
  readonly ws: WebSocketService;
  readonly wsLog: WsLogger;
  readonly coreBridge: CoreBridge;
  readonly voiceService: VoiceService;
  readonly deepToolHandler: DeepToolHandler;
  readonly callHandler: CallHandler;
  readonly smsHandler: SmsHandler;
  readonly walkieHandler: WalkieHandler;
  readonly approvalManager: ApprovalManager;
  readonly missionService: MissionService;
  readonly missionEventHandler: MissionEventHandler;
  readonly doctor: DoctorService;
}

// ── Runtime factory ─────────────────────────────────────────

async function createClawTalkRuntime(params: {
  config: ResolvedClawTalkConfig;
  coreConfig: CoreConfig;
  logger: OpenClawPluginApi['logger'];
  enqueueSystemEvent: (text: string, options: { sessionKey: string; contextKey?: string | null }) => void;
  dataDir: string;
}): Promise<ClawTalkRuntime> {
  const { config, coreConfig, logger, enqueueSystemEvent, dataDir } = params;

  // 1. SDK client
  const clientVersion = readPackageVersion();
  const client = new ClawTalkClient({
    apiKey: config.apiKey,
    server: config.server,
    clientVersion,
    logger: {
      debug: logger.debug ? (...args: unknown[]) => logger.debug?.(args.map(String).join(' ')) : undefined,
      warn: logger.warn ? (...args: unknown[]) => logger.warn?.(args.map(String).join(' ')) : undefined,
    },
  });

  // 2. WebSocket (with dedicated log file)
  const wsLog = new WsLogger(`${dataDir}/ws.log`);
  wsLog.open();
  const ws = new WebSocketService(config, logger, wsLog);

  // 3. CoreBridge
  const coreBridge = new CoreBridge({
    coreConfig,
    agentId: config.agentId,
    logger,
    enqueueSystemEvent,
  });

  // 4. VoiceService
  const voiceService = new VoiceService(config);

  // 5. Handlers
  const deepToolHandler = new DeepToolHandler({ ws, coreBridge, voiceService, logger });
  const callHandler = new CallHandler({ config, ws, voiceService, coreBridge, logger });
  const smsHandler = new SmsHandler({ client, coreBridge, logger });
  const walkieHandler = new WalkieHandler({ ws, coreBridge, voiceService, logger });

  // 6. ApprovalManager
  const approvalManager = new ApprovalManager({ client, logger });

  // 7. MissionService
  const missionService = new MissionService({ client, dataDir, logger });

  // 8. MissionEventHandler
  const missionEventHandler = new MissionEventHandler({ ws, coreBridge, missions: missionService, logger });
  missionEventHandler.start();

  // 9. DoctorService
  const doctor = new DoctorService({ client, ws, coreBridge, logger, openclawRoot: process.env.OPENCLAW_ROOT?.trim() });

  // 10. Wire WebSocket events to handlers
  ws.on('context_request', (msg) => callHandler.handleContextRequest(msg));
  ws.on('call.started', (msg) => callHandler.handleCallStarted(msg));
  ws.on('call.ended', (msg) => callHandler.handleCallEnded(msg));
  ws.on('deep_tool_request', (msg) => deepToolHandler.handle(msg));
  ws.on('sms.received', (msg) => smsHandler.handle(msg));
  ws.on('approval.responded', (msg) => approvalManager.handleWebSocketResponse(msg));
  ws.on('walkie_request', (msg) => walkieHandler.handle(msg));
  ws.on('disconnected', () => approvalManager.cleanupPending());
  ws.on('request_logs', (requestId: string) => {
    try {
      const lines = wsLog.readRecentLines(200);
      ws.send({ type: 'logs_response', request_id: requestId, lines });
    } catch (err) {
      ws.send({
        type: 'logs_response',
        request_id: requestId,
        lines: [],
        error: err instanceof Error ? err.message : 'Failed to read logs',
      });
    }
  });

  // 11. Connect WebSocket
  if (config.autoConnect) {
    try {
      await ws.connect();
      logger.info('ClawTalk service started');
    } catch (err) {
      logger.warn?.(`ClawTalk WebSocket unavailable, will retry: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    client,
    ws,
    wsLog,
    coreBridge,
    voiceService,
    deepToolHandler,
    callHandler,
    smsHandler,
    walkieHandler,
    approvalManager,
    missionService,
    missionEventHandler,
    doctor,
  };
}

// ── Plugin definition ───────────────────────────────────────

const clawTalkPlugin = {
  id: 'clawtalk',
  name: 'ClawTalk',
  description: 'Voice calls, SMS, missions, and approvals via ClawTalk',

  register(api: OpenClawPluginApi) {
    // ── Eager config parsing ──────────────────────────────
    const rawConfig = (api.pluginConfig ?? {}) as unknown as ClawTalkConfig;
    const config = resolveConfig(rawConfig);

    // OpenClaw's plugin API logger tags all output as [gateway] — there's no
    // built-in per-plugin scoping. Channels like Slack get [slack] via the
    // channel dock's runtime.log, which is a separate system.
    // We use api.logger directly and accept [gateway] tagging for now.
    // TODO: request per-plugin logger scoping upstream in OpenClaw.
    const logger = api.logger;

    if (!config.apiKey) {
      logger.warn('ClawTalk plugin loaded without API key. Tools will fail until configured.');
    }

    if (!config.enabled) {
      logger.info('ClawTalk plugin disabled via config.');
      return;
    }

    logger.info(`ClawTalk plugin loaded (server: ${config.server})`);

    // ── Lazy runtime (module-level singleton) ──────────────
    const startedAt = Date.now();

    const ensureRuntime = async (): Promise<ClawTalkRuntime> => {
      if (globalRuntime) return globalRuntime;
      if (!globalRuntimePromise) {
        globalRuntimePromise = createClawTalkRuntime({
          config,
          coreConfig: api.config as CoreConfig,
          logger: logger,
          enqueueSystemEvent: api.runtime.system.enqueueSystemEvent,
          dataDir: api.resolvePath('.'),
        });
      }
      globalRuntime = await globalRuntimePromise;
      return globalRuntime;
    };

    // ── Register tools ──────────────────────────────────────
    // Tools are created lazily: we register name/schema/description eagerly,
    // but defer tool construction until ensureRuntime() has built the services.
    let toolInstances: ReturnType<typeof createTools> | null = null;

    const getToolInstances = async (): Promise<ReturnType<typeof createTools>> => {
      if (toolInstances) return toolInstances;
      const rt = await ensureRuntime();
      toolInstances = createTools({
        config,
        client: rt.client,
        approvalManager: rt.approvalManager,
        ws: rt.ws,
        missions: rt.missionService,
        logger: logger,
      });
      return toolInstances;
    };

    // Import tool schemas eagerly (they're just static objects, no service deps)
    // We build a temporary set of tools with a dummy services object just to
    // extract names/schemas/descriptions for registration. The dummy is never
    // called because execute is wrapped.
    const dummyClient = {} as ToolServices['client'];
    const dummyApproval = {} as ToolServices['approvalManager'];
    const dummyWs = {} as ToolServices['ws'];
    const dummyMissions = {} as ToolServices['missions'];
    const skeletonTools = createTools({
      config,
      client: dummyClient,
      approvalManager: dummyApproval,
      ws: dummyWs,
      missions: dummyMissions,
      logger: logger,
    });

    for (const [toolIndex, skeleton] of skeletonTools.entries()) {
      api.registerTool({
        name: skeleton.name,
        label: skeleton.label,
        description: skeleton.description,
        parameters: skeleton.parameters,
        async execute(toolCallId: string, params: Record<string, unknown>) {
          const tools = await getToolInstances();
          const tool = tools[toolIndex];
          if (!tool) throw new Error(`Tool at index ${toolIndex} not found`);
          return tool.execute(toolCallId, params);
        },
      });
    }

    logger.info(`Registered ${skeletonTools.length} agent tools`);

    // ── Register CLI ──────────────────────────────────────
    const wsLogPath = `${api.resolvePath('.')}/ws.log`;

    api.registerCli(
      ({ program }) =>
        registerClawTalkCli({
          program,
          wsLogPath,
          logger,
        }),
      { commands: ['clawtalk'] },
    );

    // ── Register service ──────────────────────────────────
    api.registerService({
      id: 'clawtalk',
      start: async () => {
        try {
          await ensureRuntime();
        } catch (err) {
          logger.error?.(`ClawTalk service start failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
      stop: async () => {
        if (globalRuntimePromise) {
          try {
            const rt = await globalRuntimePromise;
            rt.ws.disconnect();
            rt.wsLog.close();
            logger.info('ClawTalk service stopped');
          } catch {
            // Already cleaned up
          } finally {
            globalRuntimePromise = null;
            globalRuntime = null;
          }
        }
      },
    });

    // ── Register HTTP routes ──────────────────────────────
    // Health route creates DoctorService lazily via ensureRuntime
    api.registerHttpRoute({
      path: '/clawtalk/health',
      auth: 'plugin',
      handler: async (req, res) => {
        try {
          const rt = await ensureRuntime();
          const handler = createHealthHandler({
            doctor: rt.doctor,
            ws: rt.ws,
            version: rt.ws.version,
            startedAt,
            logger: logger,
          });
          await handler(req, res);
        } catch (err) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'unavailable',
              error: err instanceof Error ? err.message : 'Runtime not ready',
            }),
          );
        }
      },
    });

    api.registerHttpRoute({
      path: '/clawtalk/webhook',
      auth: 'plugin',
      handler: async (req, res) => {
        try {
          const rt = await ensureRuntime();
          const handler = createWebhookHandler({
            doctor: rt.doctor,
            ws: rt.ws,
            version: rt.ws.version,
            startedAt,
            logger: logger,
          });
          await handler(req, res);
        } catch (_err) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Runtime not ready' }));
        }
      },
    });
  },
};

export default clawTalkPlugin;
