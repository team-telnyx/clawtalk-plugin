/**
 * Structured error types for ClawTalk plugin.
 *
 * Every error carries a code, message, and optional details.
 * Services throw these; tools catch and format for the model.
 */

export class ClawTalkError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ClawTalkError';
    this.code = code;
    this.details = details;
  }
}

/**
 * ApiError is now provided by the SDK.
 * Re-exported here for backwards compatibility.
 */
export { ApiError } from '../lib/clawtalk-sdk/errors.js';

export class WebSocketError extends ClawTalkError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = 'WebSocketError';
  }

  static authFailed(reason: string): WebSocketError {
    return new WebSocketError('WS_AUTH_FAILED', `Authentication failed: ${reason}`);
  }

  static disconnected(): WebSocketError {
    return new WebSocketError('WS_DISCONNECTED', 'WebSocket is not connected');
  }

  static duplicateClient(): WebSocketError {
    return new WebSocketError(
      'WS_DUPLICATE_CLIENT',
      'Another client is already connected. Only one connection per account is allowed.',
    );
  }

  static sendFailed(reason: string): WebSocketError {
    return new WebSocketError('WS_SEND_FAILED', `Failed to send message: ${reason}`);
  }
}

export class ConfigError extends ClawTalkError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFIG_INVALID', message, details);
    this.name = 'ConfigError';
  }

  static missingField(field: string): ConfigError {
    return new ConfigError(`Required config field missing: ${field}`, { field });
  }

  static invalidValue(field: string, reason: string): ConfigError {
    return new ConfigError(`Invalid config value for ${field}: ${reason}`, { field, reason });
  }
}

export class ToolError extends ClawTalkError {
  constructor(tool: string, message: string, details?: Record<string, unknown>) {
    super('TOOL_ERROR', `[${tool}] ${message}`, { tool, ...details });
    this.name = 'ToolError';
  }

  static agentOffline(tool: string): ToolError {
    return new ToolError(tool, 'Agent is offline. Cannot process request.');
  }

  static agentUnreachable(tool: string): ToolError {
    return new ToolError(tool, 'Cannot reach agent. Check gateway connection.');
  }

  static gatewayNotConfigured(tool: string): ToolError {
    return new ToolError(tool, 'Gateway not configured. Ensure sessions_send is in tools.allow.');
  }

  static timeout(tool: string, timeoutMs: number): ToolError {
    return new ToolError(tool, `Request timed out after ${timeoutMs}ms`, { timeoutMs });
  }

  static fromError(tool: string, err: unknown): ToolError {
    if (err instanceof ToolError) return err;
    if (err instanceof ClawTalkError) return new ToolError(tool, err.message, { code: err.code });
    // SDK ApiError: surface the server's error message + fix hints
    if (err instanceof Error && err.name === 'ApiError') {
      const apiErr = err as import('../lib/clawtalk-sdk/errors.js').ApiError;
      const hint = ToolError.getFixHint(apiErr.serverCode, apiErr.serverMessage);
      const message = hint ? `${apiErr.message}. Fix: ${hint}` : apiErr.message;
      return new ToolError(tool, message, {
        statusCode: apiErr.statusCode,
        serverCode: apiErr.serverCode,
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    return new ToolError(tool, message);
  }

  /** Return an actionable fix hint for known server error codes. */
  private static getFixHint(code?: string, message?: string): string | null {
    if (!code && !message) return null;
    const c = code || '';
    const m = (message || '').toLowerCase();

    if (c === 'step_not_found' || (m.includes('step') && m.includes('not found'))) {
      return 'Use clawtalk_mission_get_plan to list valid step IDs for this mission.';
    }
    if (c === 'missing_field') {
      return 'Check the tool parameters and provide all required fields.';
    }
    if (c === 'not_found' && m.includes('assistant')) {
      return 'Use clawtalk_assistants (action: "list") to find valid assistant IDs.';
    }
    if (c === 'not_found' && m.includes('mission')) {
      return 'Use clawtalk_mission_list to find valid mission slugs.';
    }
    if (c === 'quota_exceeded') {
      return 'The user has hit their plan limit for this resource. Inform them of the quota.';
    }
    return null;
  }
}
