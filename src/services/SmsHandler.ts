/**
 * SmsHandler — Inbound SMS lifecycle.
 *
 * On sms.received: routes the message to an embedded agent turn
 * with an SMS-scoped session (per phone number), then sends the
 * agent's reply back via the ClawTalk API.
 */

import type { ClawTalkClient } from '../lib/clawtalk-sdk/index.js';
import type { Logger } from '../types/plugin.js';
import type { WsSmsReceived } from '../types/websocket.js';
import type { ICoreBridge } from './CoreBridge.js';

const SMS_TIMEOUT_MS = 60_000;
const SMS_MAX_REPLY_LENGTH = 300;

// System prompt for SMS sessions — HARD LIMIT enforced
const SMS_SYSTEM_PROMPT = `You are replying via SMS. HARD LIMITS:

1. MAX 300 CHARACTERS (messages over 300 chars are rejected)
2. PLAIN TEXT ONLY — no markdown, no **bold**, no _italics_, no bullets, no headers, no formatting whatsoever
3. No emojis

Write like a text message: short, direct, conversational. If you can't fit the answer in 300 chars, give the most useful summary possible.`;

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function maskPhone(phone: string): string {
  if (phone.length <= 6) return '***';
  return `${phone.substring(0, 6)}***`;
}

export class SmsHandler {
  private readonly client: ClawTalkClient;
  private readonly coreBridge: ICoreBridge;
  private readonly logger: Logger;

  constructor(params: {
    client: ClawTalkClient;
    coreBridge: ICoreBridge;
    logger: Logger;
  }) {
    this.client = params.client;
    this.coreBridge = params.coreBridge;
    this.logger = params.logger;
  }

  async handle(msg: WsSmsReceived): Promise<void> {
    const { from, body, message_id: messageId, media_urls: mediaUrls } = msg;

    this.logger.info(`SMS received from ${maskPhone(from)}: ${body.substring(0, 50)}`);

    const sessionKey = `clawtalk:sms:${normalizePhone(from)}`;

    // Build prompt - include media URLs so agent can analyze them
    let prompt = body || '';

    if (mediaUrls && mediaUrls.length > 0) {
      this.logger.info(`MMS with ${mediaUrls.length} media attachment(s)`);
      const mediaList = mediaUrls.map((url) => `- ${url}`).join('\n');
      prompt = `${prompt}\n\n[MMS Attachments - analyze these images using the image tool]\n${mediaList}`;
    }

    try {
      const reply = await this.coreBridge.runAgentTurn({
        sessionKey,
        prompt,
        extraSystemPrompt: SMS_SYSTEM_PROMPT,
        timeoutMs: SMS_TIMEOUT_MS,
      });

      if (!reply) {
        this.logger.warn?.(`No reply from agent for SMS ${messageId}`);
        return;
      }

      // Truncate for SMS
      const truncated =
        reply.length > SMS_MAX_REPLY_LENGTH ? `${reply.substring(0, SMS_MAX_REPLY_LENGTH - 3)}...` : reply;

      this.logger.info(`SMS reply: ${truncated.substring(0, 50)}...`);

      await this.client.sms.send({ to: from, message: truncated });
      this.logger.info(`SMS reply sent to ${maskPhone(from)}`);
    } catch (err) {
      if (err instanceof Error && (err.message.includes('timeout') || err.message.includes('abort'))) {
        this.logger.warn?.('SMS agent timed out');
      } else {
        this.logger.error?.(`SMS handler error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
