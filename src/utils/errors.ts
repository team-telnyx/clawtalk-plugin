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

export class ApiError extends ClawTalkError {
  readonly statusCode: number;
  readonly responseBody?: string;

  constructor(statusCode: number, message: string, responseBody?: string) {
    super(`API_${statusCode}`, message, responseBody ? { responseBody } : undefined);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }

  static unauthorized(message = 'Invalid or expired API key'): ApiError {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Insufficient permissions'): ApiError {
    return new ApiError(403, message);
  }

  static notFound(resource: string): ApiError {
    return new ApiError(404, `${resource} not found`);
  }

  static rateLimited(retryAfter?: number): ApiError {
    const msg = retryAfter ? `Rate limited. Retry after ${retryAfter}s` : 'Rate limited. Try again later';
    return new ApiError(429, msg, retryAfter !== undefined ? String(retryAfter) : undefined);
  }

  static serverError(message = 'ClawTalk server error'): ApiError {
    return new ApiError(500, message);
  }
}

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
}
