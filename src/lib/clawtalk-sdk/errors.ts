/**
 * SDK-level error types for ClawTalkClient.
 *
 * These are HTTP/API errors only. Plugin-level errors (ToolError, WebSocketError, etc.)
 * remain in src/utils/errors.ts.
 */

export class ApiError extends Error {
  readonly statusCode: number;
  readonly responseBody?: string;
  /** Parsed error code from server JSON response (e.g. "not_found", "missing_field"). */
  readonly serverCode?: string;
  /** Parsed human-readable error detail from server JSON response. */
  readonly serverMessage?: string;

  constructor(statusCode: number, message: string, responseBody?: string) {
    // Try to extract a useful message from the response body
    let serverCode: string | undefined;
    let serverMessage: string | undefined;
    if (responseBody) {
      try {
        const parsed = JSON.parse(responseBody);
        const err = parsed.error || parsed;
        serverCode = err.code || undefined;
        serverMessage = err.message || err.detail || undefined;
      } catch {
        // Not JSON — use raw body if short enough
        if (responseBody.length < 200) serverMessage = responseBody;
      }
    }

    // Build a message that actually tells the agent what went wrong
    const fullMessage = serverMessage ? `${message} — ${serverMessage}` : message;

    super(fullMessage);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.serverCode = serverCode;
    this.serverMessage = serverMessage;
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
