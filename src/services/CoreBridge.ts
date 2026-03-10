/**
 * CoreBridge — In-process agent execution via OpenClaw's extensionAPI.
 *
 * Follows the same pattern as the voice-call plugin's core-bridge.ts.
 * Dynamically imports extensionAPI.js from the OpenClaw installation root
 * to run embedded agent turns (runEmbeddedPiAgent) and enqueue system events.
 *
 * Session management: each channel (voice, SMS, walkie) gets its own session
 * keyed by a stable identifier. Sessions are persisted in a JSON store file.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Logger } from '../types/plugin.js';
import { ClawTalkError } from '../utils/errors.js';

// ── Types ───────────────────────────────────────────────────

/** Subset of OpenClaw config needed by CoreBridge */
export interface CoreConfig {
  session?: { store?: string };
  [key: string]: unknown;
}

/** Signature of the enqueueSystemEvent function from the plugin runtime */
type EnqueueSystemEventFn = (text: string, options: { sessionKey: string; contextKey?: string | null }) => void;

interface SessionEntry {
  sessionId: string;
  updatedAt: number;
}

/** Parameters for running an agent turn */
export interface AgentTurnParams {
  sessionKey: string;
  prompt: string;
  extraSystemPrompt?: string;
  timeoutMs?: number;
  model?: string;
  thinkLevel?: string;
}

/** Interface for mocking in tests */
export interface ICoreBridge {
  runAgentTurn(params: AgentTurnParams): Promise<string | null>;
  enqueueSystemEvent(text: string, sessionKey: string): void;
}

// ── Extension API deps (loaded dynamically) ─────────────────

interface CoreAgentDeps {
  resolveAgentDir: (cfg: CoreConfig, agentId: string) => string;
  resolveAgentWorkspaceDir: (cfg: CoreConfig, agentId: string) => string;
  resolveAgentIdentity: (cfg: CoreConfig, agentId: string) => { name?: string | null } | null | undefined;
  resolveThinkingDefault: (params: { cfg: CoreConfig; provider?: string; model?: string }) => string;
  runEmbeddedPiAgent: (params: {
    sessionId: string;
    sessionKey?: string;
    messageProvider?: string;
    sessionFile: string;
    workspaceDir: string;
    config?: CoreConfig;
    prompt: string;
    provider?: string;
    model?: string;
    thinkLevel?: string;
    verboseLevel?: string;
    timeoutMs: number;
    runId: string;
    lane?: string;
    extraSystemPrompt?: string;
    agentDir?: string;
  }) => Promise<{
    payloads?: Array<{ text?: string; isError?: boolean }>;
    meta?: { aborted?: boolean };
  }>;
  resolveAgentTimeoutMs: (opts: { cfg: CoreConfig }) => number;
  ensureAgentWorkspace: (params?: { dir: string }) => Promise<void>;
  resolveStorePath: (store?: string, opts?: { agentId?: string }) => string;
  loadSessionStore: (storePath: string) => Record<string, unknown>;
  saveSessionStore: (storePath: string, store: Record<string, unknown>) => Promise<void>;
  resolveSessionFilePath: (sessionId: string, entry: unknown, opts?: { agentId?: string }) => string;
  DEFAULT_MODEL: string;
  DEFAULT_PROVIDER: string;
}

// ── OpenClaw root resolution ────────────────────────────────

let coreRootCache: string | null = null;

function findPackageRoot(startDir: string, name: string): string | null {
  let dir = startDir;
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      if (fs.existsSync(pkgPath)) {
        const raw = fs.readFileSync(pkgPath, 'utf8');
        const pkg = JSON.parse(raw) as { name?: string };
        if (pkg.name === name) {
          return dir;
        }
      }
    } catch {
      // ignore parse errors, keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveOpenClawRoot(): string {
  if (coreRootCache) return coreRootCache;

  const override = process.env.OPENCLAW_ROOT?.trim();
  if (override) {
    coreRootCache = override;
    return override;
  }

  const candidates = new Set<string>();
  // Follow symlinks: process.argv[1] is often a symlink in /opt/homebrew/bin
  // that points into the real openclaw package directory.
  if (process.argv[1]) {
    try {
      const realArgv = fs.realpathSync(process.argv[1]);
      candidates.add(path.dirname(realArgv));
    } catch {
      candidates.add(path.dirname(process.argv[1]));
    }
  }
  candidates.add(process.cwd());
  try {
    const urlPath = fileURLToPath(import.meta.url);
    candidates.add(path.dirname(urlPath));
  } catch {
    // ignore
  }

  for (const start of candidates) {
    const found = findPackageRoot(start, 'openclaw');
    if (found) {
      coreRootCache = found;
      return found;
    }
  }

  throw new Error('Unable to resolve OpenClaw root. Set OPENCLAW_ROOT to the package root.');
}

// ── Lazy loader ─────────────────────────────────────────────

let coreDepsPromise: Promise<CoreAgentDeps> | null = null;

async function loadCoreAgentDeps(): Promise<CoreAgentDeps> {
  if (coreDepsPromise) return coreDepsPromise;

  coreDepsPromise = (async () => {
    const distPath = path.join(resolveOpenClawRoot(), 'dist', 'extensionAPI.js');
    if (!fs.existsSync(distPath)) {
      throw new Error(`Missing core module at ${distPath}. Is OpenClaw installed?`);
    }
    return (await import(pathToFileURL(distPath).href)) as CoreAgentDeps;
  })();

  return coreDepsPromise;
}

// ── CoreBridge ──────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_AGENT_ID = 'main';

export class CoreBridge implements ICoreBridge {
  private readonly coreConfig: CoreConfig;
  private readonly agentId: string;
  private readonly logger: Logger;
  private readonly enqueueSystemEventFn: EnqueueSystemEventFn;

  constructor(params: {
    coreConfig: CoreConfig;
    agentId?: string;
    logger: Logger;
    enqueueSystemEvent: EnqueueSystemEventFn;
  }) {
    this.coreConfig = params.coreConfig;
    this.agentId = params.agentId ?? DEFAULT_AGENT_ID;
    this.logger = params.logger;
    this.enqueueSystemEventFn = params.enqueueSystemEvent;
  }

  async runAgentTurn(params: AgentTurnParams): Promise<string | null> {
    let deps: CoreAgentDeps;
    try {
      deps = await loadCoreAgentDeps();
    } catch (err) {
      throw new ClawTalkError(
        'CORE_BRIDGE_UNAVAILABLE',
        `CoreBridge unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const cfg = this.coreConfig;
    const agentId = this.agentId;

    // Resolve paths
    const storePath = deps.resolveStorePath(cfg.session?.store, { agentId });
    const agentDir = deps.resolveAgentDir(cfg, agentId);
    const workspaceDir = deps.resolveAgentWorkspaceDir(cfg, agentId);

    await deps.ensureAgentWorkspace({ dir: workspaceDir });

    // Load or create session entry
    const sessionStore = deps.loadSessionStore(storePath);
    const now = Date.now();
    let entry = sessionStore[params.sessionKey] as SessionEntry | undefined;

    if (!entry) {
      entry = { sessionId: crypto.randomUUID(), updatedAt: now };
      sessionStore[params.sessionKey] = entry;
      await deps.saveSessionStore(storePath, sessionStore);
    }

    const sessionId = entry.sessionId;
    const sessionFile = deps.resolveSessionFilePath(sessionId, entry, { agentId });

    // Resolve model
    const modelRef = params.model ?? `${deps.DEFAULT_PROVIDER}/${deps.DEFAULT_MODEL}`;
    const slashIndex = modelRef.indexOf('/');
    const provider = slashIndex === -1 ? deps.DEFAULT_PROVIDER : modelRef.slice(0, slashIndex);
    const model = slashIndex === -1 ? modelRef : modelRef.slice(slashIndex + 1);

    const thinkLevel = params.thinkLevel ?? deps.resolveThinkingDefault({ cfg, provider, model });
    const timeoutMs = params.timeoutMs ?? deps.resolveAgentTimeoutMs({ cfg }) ?? DEFAULT_TIMEOUT_MS;
    const runId = `clawtalk:${params.sessionKey}:${Date.now()}`;

    this.logger.debug?.(`CoreBridge: running agent turn session=${params.sessionKey} timeout=${timeoutMs}ms`);

    try {
      const result = await deps.runEmbeddedPiAgent({
        sessionId,
        sessionKey: params.sessionKey,
        messageProvider: 'clawtalk',
        sessionFile,
        workspaceDir,
        config: cfg,
        prompt: params.prompt,
        provider,
        model,
        thinkLevel,
        verboseLevel: 'off',
        timeoutMs,
        runId,
        lane: 'clawtalk',
        extraSystemPrompt: params.extraSystemPrompt,
        agentDir,
      });

      // Extract text from payloads
      const texts = (result.payloads ?? [])
        .filter((p) => p.text && !p.isError)
        .map((p) => p.text?.trim())
        .filter(Boolean);

      const text = texts.join(' ') || null;

      if (!text && result.meta?.aborted) {
        this.logger.warn?.('CoreBridge: agent turn aborted');
        return null;
      }

      return text;
    } catch (err) {
      this.logger.error?.(`CoreBridge: agent turn failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new ClawTalkError(
        'AGENT_EXECUTION_FAILED',
        `Agent execution failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  enqueueSystemEvent(text: string, sessionKey: string): void {
    this.logger.debug?.(`CoreBridge: enqueuing system event to ${sessionKey}`);
    this.enqueueSystemEventFn(text, { sessionKey });
  }
}
