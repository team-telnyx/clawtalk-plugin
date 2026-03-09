/**
 * ClawTalk OpenClaw Plugin entry point.
 *
 * Registers background services, agent tools, HTTP routes, and doctor checks.
 * Implementation in Phase 6 — this is the scaffold.
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

export default function activate(api: OpenClawPluginApi): void {
  api.logger.info('ClawTalk plugin loaded (scaffold)');

  // Phase 2: ApiClient + WebSocketService
  // Phase 3: Event handlers
  // Phase 4: Agent tools registration
  // Phase 5: Mission tools registration
  // Phase 6: Service lifecycle, HTTP routes, doctor checks
}
