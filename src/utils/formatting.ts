/**
 * Formatting utilities for ClawTalk plugin.
 *
 * - formatDuration: seconds → human-readable string (date-fns)
 * - formatPhoneNumber: E.164 → national display format (libphonenumber-js)
 * - cleanTextForVoice: strip markdown/emoji/JSON for TTS output
 */

import { formatDuration as fmtDuration, intervalToDuration } from 'date-fns';
import { parsePhoneNumber } from 'libphonenumber-js';

/**
 * Format seconds into a human-readable duration string.
 * e.g. 125 → "2 minutes 5 seconds"
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0 seconds';
  const duration = intervalToDuration({ start: 0, end: seconds * 1000 });
  return fmtDuration(duration);
}

/**
 * Format an E.164 phone number into a readable national format.
 * Falls back to the raw input if parsing fails.
 */
export function formatPhoneNumber(e164: string): string {
  try {
    const parsed = parsePhoneNumber(e164);
    if (parsed) {
      return parsed.formatNational();
    }
  } catch {
    // Fall through to raw return
  }
  return e164;
}

/**
 * Clean text for voice TTS output.
 *
 * Strips markdown formatting, links, emojis, and filters out raw JSON
 * tool call attempts that would sound awful when spoken aloud.
 *
 * Ported from ws-client.js cleanForVoice().
 */
export function cleanTextForVoice(text: string): string {
  if (!text) return '';

  const stripped = text.trim();

  // Filter JSON tool call attempts — return a safe fallback
  if (stripped.startsWith('{') && stripped.endsWith('}')) {
    try {
      const parsed = JSON.parse(stripped) as Record<string, unknown>;
      if (parsed.name || parsed.function || parsed.tool_call || parsed.arguments) {
        return 'Done.';
      }
    } catch {
      // Not valid JSON, continue with normal cleaning
    }
  }

  return (
    text
      // Strip markdown formatting characters
      .replace(/[*_~`#>]/g, '')
      // Convert markdown links to just the text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Double newlines become sentence breaks
      .replace(/\n{2,}/g, '. ')
      // Single newlines become spaces
      .replace(/\n/g, ' ')
      // Collapse multiple spaces
      .replace(/\s{2,}/g, ' ')
      // Strip emojis and non-Latin unicode (keep ASCII + Latin Extended for accented names)
      .replace(/[^\u0020-\u007F\u00C0-\u024F\u1E00-\u1EFF]/g, '')
      .trim()
  );
}
