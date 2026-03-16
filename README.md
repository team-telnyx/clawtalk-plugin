# ClawTalk

OpenClaw plugin for [ClawTalk](https://clawdtalk.com) — voice calls, SMS, AI missions, and push-notification approvals.

Your AI agent gets a phone number. It can make and receive calls, send and receive texts, run multi-step outreach campaigns (missions), and request approval for sensitive actions via push notification.

**Powered by [Telnyx](https://telnyx.com).**

## Install

```bash
openclaw plugins install clawtalk
```

## Prerequisites

- [OpenClaw](https://openclaw.ai) installed and running
- A [ClawTalk](https://clawdtalk.com) account with an API key

## Configuration

After installing, open your OpenClaw config (`~/.openclaw/openclaw.json`) and add your API key:

```json
{
  "plugins": {
    "entries": {
      "clawtalk": {
        "enabled": true,
        "config": {
          "apiKey": "your-clawtalk-api-key"
        }
      }
    }
  }
}
```

Then restart the gateway:

```bash
openclaw gateway restart
```

That's it. The plugin will connect to ClawTalk, authenticate via WebSocket, and register all 20 tools. Run `openclaw clawtalk doctor` to verify everything is healthy.

### Optional Settings

Everything below has sensible defaults. Only set them if you need to customise behaviour.

```json
{
  "clawtalk": {
    "enabled": true,
    "config": {
      "apiKey": "your-api-key",
      "ownerName": "Your Name",
      "agentName": "My Agent"
    }
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `apiKey` | — | **Required.** ClawTalk API key |
| `server` | `https://clawdtalk.com` | ClawTalk server URL |
| `ownerName` | `"there"` | Your name — used in the inbound call greeting and voice context |
| `agentName` | `"ClawTalk"` | Your agent's name — the AI identifies itself as this on calls |
| `greeting` | `"Hey {ownerName}, what's up?"` | Spoken when you call your agent |
| `agentId` | `"main"` | Which OpenClaw agent handles calls/SMS (multi-agent setups) |
| `autoConnect` | `true` | Connect WebSocket on startup |
| `voiceContext` | Built-in | Override the system prompt used during voice calls |
| `missions.enabled` | `true` | Enable mission tools |
| `missions.defaultVoice` | — | Default TTS voice for mission assistants |
| `missions.defaultModel` | — | Default LLM for mission assistants |

## What It Does

### Voice Calls

- **Inbound:** Your agent answers calls on its dedicated number. Callers authenticate via PIN, then talk directly to the AI assistant with full tool access.
- **Outbound:** Schedule calls to external numbers. The AI assistant handles the conversation with custom instructions and greeting.
- **Deep tool routing:** During calls, the Telnyx Voice AI can invoke your OpenClaw agent's tools (search the web, check Slack, read memory) and speak the results back to the caller.
- **Push-to-talk:** Walkie-talkie style messages from the ClawTalk mobile app, processed by the agent and replied to via voice.

### SMS

- **Send and receive:** Full SMS/MMS support. Inbound messages create persistent per-number conversation sessions.
- **Mission SMS:** Schedule texts as part of multi-step campaigns. Replies from targets are routed into the correct mission context with thread history.

### Missions

Missions are multi-step outreach campaigns. The agent creates a plan, sets up a voice assistant, schedules calls and texts, and processes results in real-time via WebSocket events.

- **Dedicated session per mission** — no context bleed between concurrent missions
- **Real-time event handling** — call transcripts, SMS replies, delivery confirmations, and AI insights arrive via WebSocket
- **Step lifecycle enforcement** — state machine prevents invalid transitions (no going backwards from completed/failed)
- **Background observer** — detects stale missions, unresolved call outcomes, and completed-but-unclosed missions

### Approvals

Request user approval for sensitive actions via push notification to the ClawTalk mobile app. Supports biometric confirmation (Face ID / fingerprint) for high-security actions.

### Health & Diagnostics

- Built-in doctor checks (WebSocket, CoreBridge roundtrip, server health)
- WebSocket log file with automatic rotation and API key redaction
- CLI: `openclaw clawtalk logs` to tail the WebSocket log

## Tools

The plugin registers 20 agent tools:

### Communication

| Tool | Description |
|------|-------------|
| `clawtalk_call` | Initiate an outbound phone call |
| `clawtalk_call_status` | Check call status or hang up |
| `clawtalk_sms` | Send SMS or MMS |
| `clawtalk_sms_list` | List recent messages (filter by contact/direction) |
| `clawtalk_sms_conversations` | List SMS conversations |
| `clawtalk_approve` | Request push-notification approval |
| `clawtalk_status` | Check connection, version, WebSocket health |

### Missions

| Tool | Description |
|------|-------------|
| `clawtalk_mission_init` | Create a mission with plan steps |
| `clawtalk_mission_setup_agent` | Create voice assistant and link to mission |
| `clawtalk_mission_schedule` | Schedule a call or SMS event |
| `clawtalk_mission_event_status` | Check scheduled event status |
| `clawtalk_mission_update_step` | Update plan step (state machine enforced) |
| `clawtalk_mission_log_event` | Log an event to the mission run |
| `clawtalk_mission_memory` | Save/load/append mission memory |
| `clawtalk_mission_complete` | Complete mission (all steps must be terminal) |
| `clawtalk_mission_list` | List missions (local state or server API) |
| `clawtalk_mission_get_plan` | Get plan steps from server |
| `clawtalk_mission_cancel_event` | Cancel a scheduled event |

### Standalone

| Tool | Description |
|------|-------------|
| `clawtalk_assistants` | List, create, get, or update voice assistants |
| `clawtalk_insights` | Get AI-generated conversation insights |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  OpenClaw Gateway                │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │            ClawTalk Plugin                │   │
│  │                                           │   │
│  │  ┌─────────────┐   ┌──────────────────┐  │   │
│  │  │ ClawTalkSDK │   │  WebSocketService │──┼───┼──→ ClawTalk Server
│  │  │ (REST API)  │   │  (persistent WS)  │  │   │
│  │  └─────────────┘   └────────┬─────────┘  │   │
│  │                              │            │   │
│  │  ┌──────────┐  ┌────────────┤            │   │
│  │  │CoreBridge│  │ Event Handlers:          │   │
│  │  │(in-proc  │←─┤ • CallHandler            │   │
│  │  │ agent)   │  │ • DeepToolHandler        │   │
│  │  └──────────┘  │ • SmsHandler             │   │
│  │       ↑        │ • WalkieHandler          │   │
│  │       │        │ • MissionEventHandler    │   │
│  │  23 Agent      │ • ApprovalManager        │   │
│  │   Tools        └──────────────────────────┘  │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

**CoreBridge** runs agent turns in-process via OpenClaw's extension API. No HTTP round-trips to the gateway. Each channel (voice, SMS, walkie, mission) gets its own persistent session.

**WebSocketService** maintains a persistent connection to the ClawTalk server with authentication, ping/pong keepalive, exponential backoff reconnect, and typed event dispatch.

**MissionObserver** runs on a background interval (default 5 min), independent of chat turns. Detects stuck missions and nudges the appropriate mission session.

## Security

- **PIN authentication** on inbound calls (configurable per user)
- **Whitelist** for calls and SMS (silently drops non-whitelisted contacts)
- **Lakera Guard** screens all external SMS and voice tool requests for prompt injection
- **STIR/SHAKEN** verification with paranoid mode (reject unverified callers)
- **External caller tool blocking** — whitelisted callbacks can converse but cannot invoke agent tools
- **Push-notification approvals** with optional biometric confirmation
- **IO screening** fails closed (service unavailable = request blocked)

## Development

```bash
git clone https://github.com/team-telnyx/clawtalk-plugin
cd clawtalk-plugin
npm install
npm run typecheck    # TypeScript check
npm run lint         # Biome linter
npm run test         # Vitest test suite
npm run build        # SWC compiler → build/
```

### Project Structure

```
src/
├── index.ts                    # Plugin entry point
├── config.ts                   # Config interface + defaults
├── cli.ts                      # CLI commands (openclaw clawtalk logs)
├── tools/                      # 23 agent tools
├── services/
│   ├── CoreBridge.ts           # In-process agent execution
│   ├── WebSocketService.ts     # Persistent WS connection
│   ├── CallHandler.ts          # Call lifecycle (context, greeting, outcome)
│   ├── DeepToolHandler.ts      # Voice → agent tool routing
│   ├── SmsHandler.ts           # Inbound SMS → agent → reply
│   ├── WalkieHandler.ts        # Push-to-talk
│   ├── MissionEventHandler.ts  # Real-time mission events
│   ├── MissionObserver.ts      # Background lifecycle checks
│   ├── MissionService.ts       # Mission state + API orchestration
│   ├── ApprovalManager.ts      # Push notification approvals
│   ├── VoiceService.ts         # Voice context + TTS cleanup
│   └── DoctorService.ts        # Health checks
├── lib/clawtalk-sdk/           # Typed REST client (Stripe-style namespaces)
├── routes/                     # HTTP endpoints (/clawtalk/health)
├── types/                      # TypeScript type definitions
└── utils/                      # Errors, formatting, WS logger
```

## License

MIT
