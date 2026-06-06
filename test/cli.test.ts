import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readOpenClawEnv, resolveConfigString } from '../src/cli.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawtalk-cli-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('CLI config helpers', () => {
  it('returns literal config values unchanged', () => {
    expect(resolveConfigString('cc_live_test', {})).toEqual({ value: 'cc_live_test' });
  });

  it('resolves ${VAR} placeholders from OpenClaw .env', () => {
    expect(resolveConfigString('${CLAWDTALK_API_KEY}', { CLAWDTALK_API_KEY: 'from-dotenv' })).toEqual({
      value: 'from-dotenv',
      source: 'CLAWDTALK_API_KEY',
      reference: '${CLAWDTALK_API_KEY}',
    });
  });

  it('reports unresolved placeholders without sending the literal reference as a key', () => {
    expect(resolveConfigString('${CLAWDTALK_API_KEY}', {})).toEqual({
      reference: '${CLAWDTALK_API_KEY}',
      unresolved: true,
    });
  });

  it('reads simple .env files with optional export and quotes', () => {
    const dir = makeTempDir();
    const envPath = path.join(dir, '.env');
    fs.writeFileSync(
      envPath,
      [
        '# comment',
        'CLAWDTALK_API_KEY="quoted-key"',
        "CLAWDTALK_SERVER='https://clawdtalk.com'",
        'export CLAWTALK_OWNER=Howard',
      ].join('\n'),
    );

    expect(readOpenClawEnv(envPath)).toEqual({
      CLAWDTALK_API_KEY: 'quoted-key',
      CLAWTALK_OWNER: 'Howard',
      CLAWDTALK_SERVER: 'https://clawdtalk.com',
    });
  });
});
