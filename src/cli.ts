/**
 * ClawTalk CLI — registered via api.registerCli().
 *
 * Commands:
 *   openclaw clawtalk logs     — Tail the WS log file (live output)
 *   openclaw clawtalk config   — Reconfigure API key / server URL
 *   openclaw clawtalk doctor   — Verify API key and server connectivity
 *
 * Note: We define a minimal CommandLike interface instead of importing
 * `Command` from `commander` because @swc/cli pulls in commander@8 while
 * OpenClaw uses commander@14, causing type conflicts. The interface covers
 * only the Commander API surface we actually use.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tty from 'node:tty';

// Local sleep to avoid dependency on plugin-sdk in CLI context
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/* eslint-disable no-console -- CLI commands use console for output */

// ── Types ───────────────────────────────────────────────────

interface CommandLike {
  command(name: string): CommandLike;
  description(str: string): CommandLike;
  option(flags: string, description: string, defaultValue?: string): CommandLike;
  addHelpText?(position: string, text: string | (() => string)): CommandLike;
  // biome-ignore lint/suspicious/noExplicitAny: Commander's action signature is inherently loose
  action(fn: (...args: any[]) => void | Promise<void>): CommandLike;
}

type Logger = {
  info: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

// ── Constants ───────────────────────────────────────────────

const DEFAULT_SERVER = 'https://clawdtalk.com';
const API_KEY_PATTERN = /^cc_live_[a-f0-9]{40}$/;
const SERVER_PATTERN = /clawtalk|clawdtalk/i;
const DOCS_URL = 'https://clawdtalk.com/docs/plugin';

const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const RED = '\x1b[0;31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

// ── Helpers ─────────────────────────────────────────────────

/**
 * Synchronous readline from /dev/tty.
 * When silent is true, terminal echo is suppressed via Node's tty.ReadStream
 * raw mode so secrets (API keys) are not visible while typing.
 * A SIGINT handler ensures the terminal is restored if the user hits Ctrl+C.
 */
function readlineSync(prompt: string, opts?: { silent?: boolean }): string {
  const fd = fs.openSync('/dev/tty', 'r');
  let ttyStream: tty.ReadStream | undefined;
  let sigintHandler: (() => void) | undefined;

  try {
    if (opts?.silent && tty.isatty(fd)) {
      ttyStream = new tty.ReadStream(fd);
      ttyStream.setRawMode(true);

      sigintHandler = () => {
        ttyStream?.setRawMode(false);
        process.stdout.write('\n');
        process.exit(130);
      };
      process.on('SIGINT', sigintHandler);
    }

    process.stdout.write(prompt);

    const chunks: Buffer[] = [];
    const byte = Buffer.alloc(1);
    while (true) {
      const n = fs.readSync(fd, byte, 0, 1, null);
      if (n === 0) break;
      // In raw mode, Ctrl+C comes through as 0x03
      if (byte[0] === 0x03) {
        ttyStream?.setRawMode(false);
        process.stdout.write('\n');
        process.exit(130);
      }
      if (byte[0] === 0x0a || byte[0] === 0x0d) break; // \n or \r
      // Backspace/delete support
      if (byte[0] === 0x7f || byte[0] === 0x08) {
        if (chunks.length > 0) chunks.pop();
        continue;
      }
      chunks.push(Buffer.from(byte));
    }

    return Buffer.concat(chunks).toString('utf8').trim();
  } finally {
    if (ttyStream) {
      ttyStream.setRawMode(false);
      process.stdout.write('\n');
    }
    if (sigintHandler) {
      process.removeListener('SIGINT', sigintHandler);
    }
    fs.closeSync(fd);
  }
}

function maskKey(key: string): string {
  if (key.length < 12) return '****';
  return `${key.slice(0, 4)}····${key.slice(-4)}`;
}

function getConfigPath(): string {
  return path.join(os.homedir(), '.openclaw', 'openclaw.json');
}

// biome-ignore lint/suspicious/noExplicitAny: config shape is dynamic
function readConfig(): any {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found at ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

/**
 * Load config or exit with an error message. Avoids repeated try/catch
 * in every command action.
 */
// biome-ignore lint/suspicious/noExplicitAny: config shape is dynamic
function loadConfigOrDie(): any {
  try {
    return readConfig();
  } catch {
    console.error(`${RED}✗ Could not read OpenClaw config at ${getConfigPath()}${NC}`);
    process.exit(1);
  }
}

/**
 * Atomic config write: backup original, write to .tmp, rename into place.
 * Backup is preserved on failure and cleaned on success.
 * Tmp file is cleaned on rename failure.
 */
function writeConfig(json: Record<string, unknown>): void {
  const configPath = getConfigPath();
  const tmpPath = `${configPath}.tmp.${process.pid}`;
  const backupPath = `${configPath}.bak.${process.pid}`;

  fs.copyFileSync(configPath, backupPath);
  fs.writeFileSync(tmpPath, `${JSON.stringify(json, null, 2)}\n`);

  try {
    fs.renameSync(tmpPath, configPath);
  } catch (err) {
    // Clean up tmp on failure, preserve backup
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }

  try {
    fs.unlinkSync(backupPath);
  } catch {
    /* ignore */
  }
}

// biome-ignore lint/suspicious/noExplicitAny: config shape is dynamic
function getPluginConfig(config: any): { apiKey?: string; server?: string } {
  return config?.plugins?.entries?.clawtalk?.config ?? {};
}

/**
 * Validate a server URL: must be HTTPS and hostname must contain clawtalk/clawdtalk.
 * Checks the hostname specifically to prevent credential exfiltration via crafted URLs
 * like https://evil.com/?clawtalk.
 * Returns an error message or undefined if valid.
 */
function validateServerUrl(url: string): string | undefined {
  if (!url.startsWith('https://')) {
    return 'Server URL must use HTTPS.';
  }
  try {
    const { hostname } = new URL(url);
    if (!SERVER_PATTERN.test(hostname)) {
      return "Server hostname must contain 'clawtalk' or 'clawdtalk'.";
    }
  } catch {
    return 'Invalid URL format.';
  }
  return undefined;
}

/**
 * Find the WS log file. The path from registerCli may differ from the
 * runtime location, so we check known candidates.
 */
function findWsLog(wsLogPath: string): string | undefined {
  const ocDir = path.join(os.homedir(), '.openclaw');
  const candidates = [
    wsLogPath,
    path.join(ocDir, 'workspace', 'skills', 'clawdtalk-client', 'ws.log'),
    path.join(ocDir, 'ws.log'),
    path.join(ocDir, 'workspace', 'ws.log'),
  ];
  // Pick the most recently modified log file, not just the first that exists.
  // Multiple stale logs can mislead the CLI into tailing the wrong file.
  let best: { path: string; mtime: number } | undefined;
  for (const p of candidates) {
    try {
      const stat = fs.statSync(p);
      if (!best || stat.mtimeMs > best.mtime) {
        best = { path: p, mtime: stat.mtimeMs };
      }
    } catch {
      // doesn't exist, skip
    }
  }
  return best?.path;
}

// ── Doctor types ────────────────────────────────────────────

interface DoctorCheck {
  id: string;
  status: string;
  detail?: string | null;
}

interface DoctorResponse {
  checks: DoctorCheck[];
}

// ── CLI Registration ────────────────────────────────────────

export function registerClawTalkCli(params: { program: CommandLike; wsLogPath: string; logger: Logger }) {
  const { program, wsLogPath, logger } = params;

  const root = program.command('clawtalk').description('ClawTalk plugin utilities');
  root.addHelpText?.('after', `\nDocs: ${DOCS_URL}\n`);

  // ── logs ───────────────────────────────────────────────
  root
    .command('logs')
    .description('Tail the ClawTalk WebSocket log (live output)')
    .option('--since <n>', 'Print last N lines first', '50')
    .option('--poll <ms>', 'Poll interval in ms', '250')
    .action(async (options: { since?: string; poll?: string }) => {
      const since = Math.max(0, Number(options.since ?? 50));
      const pollMs = Math.max(50, Number(options.poll ?? 250));

      const logFile = findWsLog(wsLogPath);
      if (!logFile) {
        logger.error?.('No WS log file found');
        logger.info('The log file is created when the ClawTalk plugin connects. Start the gateway first.');
        process.exit(1);
      }

      const initial = fs.readFileSync(logFile, 'utf8');
      const lines = initial.split('\n').filter(Boolean);
      for (const line of lines.slice(Math.max(0, lines.length - since))) {
        console.log(line);
      }

      let offset = Buffer.byteLength(initial, 'utf8');

      for (;;) {
        try {
          const stat = fs.statSync(logFile);
          if (stat.size < offset) offset = 0;
          if (stat.size > offset) {
            const fd = fs.openSync(logFile, 'r');
            try {
              const buf = Buffer.alloc(stat.size - offset);
              fs.readSync(fd, buf, 0, buf.length, offset);
              offset = stat.size;
              for (const line of buf.toString('utf8').split('\n').filter(Boolean)) {
                console.log(line);
              }
            } finally {
              fs.closeSync(fd);
            }
          }
        } catch {
          // File may have been rotated, retry
        }
        await sleep(pollMs);
      }
    });

  // ── doctor ─────────────────────────────────────────────
  root
    .command('doctor')
    .description('Verify ClawTalk configuration and connectivity')
    .action(async () => {
      const config = loadConfigOrDie();
      const { apiKey, server } = getPluginConfig(config);
      const baseUrl = (server ?? DEFAULT_SERVER).replace(/\/+$/, '');
      const headers = { Authorization: `Bearer ${apiKey ?? ''}` };

      console.log();
      console.log(`${BOLD}ClawTalk Doctor${NC}`);
      console.log();
      console.log(`  API Key:  ${apiKey ? maskKey(apiKey) : `${RED}not set${NC}`}`);
      console.log(`  Server:   ${baseUrl}`);

      if (!apiKey) {
        console.log(`  Health:   ${RED}NO API KEY${NC}`);
        console.log();
        console.log(`  Run ${BOLD}openclaw clawtalk config${NC} to set your API key.`);
        console.log();
        process.exit(1);
      }

      const serverErr = validateServerUrl(baseUrl);
      if (serverErr) {
        console.log(`  Health:   ${RED}UNSUPPORTED_SERVER${NC}`);
        console.log();
        console.log(`  ${serverErr}`);
        console.log(`  Run ${BOLD}openclaw clawtalk config${NC} to fix.`);
        console.log();
        process.exit(1);
      }

      // Fetch /v1/me for account info
      try {
        const res = await fetch(`${baseUrl}/v1/me`, { headers, signal: AbortSignal.timeout(10_000) });
        if (res.ok) {
          try {
            const data = (await res.json()) as { email?: string; effective_tier?: string };
            if (data.email) console.log(`  Account:  ${data.email}`);
            if (data.effective_tier) console.log(`  Plan:     ${data.effective_tier}`);
          } catch {
            console.log(`  ${YELLOW}⚠${NC} Could not parse account info`);
          }
        } else if (res.status === 401 || res.status === 403) {
          console.log(`  Health:   ${RED}AUTH FAILED${NC}`);
          console.log();
          console.log('  Your API key was rejected. Generate a new one at:');
          console.log(`  ${baseUrl}/portal/dashboard`);
          console.log();
          console.log(`  Then run: ${BOLD}openclaw clawtalk config${NC}`);
          console.log();
          process.exit(1);
        } else {
          console.log(`  Health:   ${YELLOW}ERROR (HTTP ${res.status})${NC}`);
          console.log();
          process.exit(1);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  Health:   ${RED}UNREACHABLE${NC}`);
        console.log();
        console.log(`  Could not connect to ${baseUrl}`);
        console.log(`  ${DIM}${msg}${NC}`);
        console.log();
        process.exit(1);
      }

      // Fetch all doctor endpoints
      const sections: { label: string; path: string }[] = [
        { label: 'Critical', path: '/v1/doctor/critical' },
        { label: 'Warnings', path: '/v1/doctor/warnings' },
        { label: 'Recommended', path: '/v1/doctor/recommended' },
        { label: 'Infrastructure', path: '/v1/doctor/infra' },
      ];

      for (const section of sections) {
        try {
          const res = await fetch(`${baseUrl}${section.path}`, {
            headers,
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) continue;
          const data = (await res.json()) as DoctorResponse;
          if (!data.checks?.length) continue;

          console.log();
          console.log(`  ${BOLD}${section.label}${NC}`);

          for (const check of data.checks) {
            const icon =
              check.status === 'pass' ? `${GREEN}✓${NC}` : check.status === 'warn' ? `${YELLOW}⚠${NC}` : `${RED}✗${NC}`;
            const detail = check.detail ? ` ${DIM}${check.detail}${NC}` : '';
            console.log(`  ${icon} ${check.id}${detail}`);
          }
        } catch {
          // Skip section on network error
        }
      }

      // Show last 5 WS log lines if available
      const logFile = findWsLog(wsLogPath);
      if (logFile) {
        try {
          const logContent = fs.readFileSync(logFile, 'utf8');
          const logLines = logContent.split('\n').filter(Boolean);
          if (logLines.length > 0) {
            const recent = logLines.slice(Math.max(0, logLines.length - 5));
            console.log();
            console.log(`  ${BOLD}WebSocket Log${NC}`);
            for (const line of recent) {
              console.log(`  ${DIM}${line}${NC}`);
            }
          }
        } catch {
          // Log file may have been rotated or deleted between check and read
        }
      }

      console.log();
    });

  // ── config ─────────────────────────────────────────────
  root
    .command('config')
    .description('Reconfigure ClawTalk API key and server URL')
    .action(async () => {
      const json = loadConfigOrDie();
      const current = getPluginConfig(json);

      console.log();
      console.log(`${BOLD}ClawTalk — Reconfigure${NC}`);
      console.log();

      if (current.apiKey) {
        console.log(`  ${DIM}Current API Key: ${maskKey(current.apiKey)}${NC}`);
      }
      console.log(`  ${DIM}Current Server:  ${current.server ?? DEFAULT_SERVER}${NC}`);
      console.log();

      const newKey = readlineSync('  New API key (blank to keep current): ', { silent: true });
      const apiKey = newKey || current.apiKey;
      if (!apiKey) {
        console.error(`${RED}✗ No API key configured${NC}`);
        process.exit(1);
      }
      if (!API_KEY_PATTERN.test(apiKey)) {
        console.error(`${RED}✗ Invalid API key format${NC}`);
        console.error('  Keys start with cc_live_ followed by 40 hex characters.');
        console.error(`  Generate one at: ${DEFAULT_SERVER}/portal/dashboard`);
        process.exit(1);
      }

      const newServer = readlineSync(`  Server URL [${current.server ?? DEFAULT_SERVER}]: `);
      const server = newServer || current.server || DEFAULT_SERVER;

      const serverErr = validateServerUrl(server);
      if (serverErr) {
        console.error(`\n${RED}✗ UNSUPPORTED_SERVER${NC}`);
        console.error(`  ${serverErr}`);
        process.exit(1);
      }
      console.log();

      // Mutate the already-loaded config and write once
      json.plugins = json.plugins ?? {};
      json.plugins.entries = json.plugins.entries ?? {};
      json.plugins.entries.clawtalk = json.plugins.entries.clawtalk ?? {};
      json.plugins.entries.clawtalk.config = { apiKey, server };

      try {
        writeConfig(json);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${RED}✗ Failed to write config${NC}`);
        console.error(`  ${DIM}${msg}${NC}`);
        process.exit(1);
      }

      console.log(`  ${GREEN}✓${NC} Config updated`);
      console.log();
      console.log(`  Restart to apply: ${BOLD}openclaw gateway restart${NC}`);
      console.log();
    });
}
