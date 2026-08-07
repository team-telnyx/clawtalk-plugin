# Changelog

All notable changes to this project will be documented in this file.

## [0.2.4] - 2026-08-07

> Note: `0.2.3` was published to npm before these fixes landed; `0.2.4` is the
> first release containing them.

### Fixed
- Plugin registration no longer crashes when the host omits `api.resolvePath`
  (older/reduced plugin APIs): `dataDir` and the WS log path fall back to
  `~/.openclaw/clawtalk`. A crash here prevented the ClawTalk service from
  registering, leaving the WebSocket permanently disconnected.
- Logger adapter now always exposes `warn`/`error`/`debug` (falls back to
  `info`) instead of leaving them undefined.
- `openclaw clawtalk doctor` typo: `config.apiKeys` → `config.apiKey`.

### Added
- Manifest `activation` (startup + `plugins.entries.clawtalk` config path) and
  `contracts.tools` declarations for lazy plugin loading on newer OpenClaw.
- CLI command descriptors for lazy CLI registration (`openclaw clawtalk …`).
- Startup auto-connect: when `apiKey` is set and `autoConnect` is enabled the
  runtime (and its WebSocket) starts with the gateway instead of waiting for
  the first tool call.
- `openclaw clawtalk doctor` now prints WebSocket recovery guidance when
  `bot_connected` fails: the gateway owns the WS lifecycle — verify the
  ClawTalk service started, review `openclaw clawtalk logs`, restart the
  gateway after install/update (never `scripts/connect.sh`).
- README: "Troubleshooting the WebSocket" section documenting the
  gateway-owned connection lifecycle.

## [0.2.0] - 2026-03-25

### Added
- **BotConfigTool** (`clawtalk_bot_config`): New tool for managing bot settings
  - `get` action: Read current bot config (name, role, greeting, voice, language, instructions)
  - `update` action: Update any combination of bot settings
  - `list_voices` action: Browse 2,200+ TTS voices with filters (provider, language, gender, accent, search)
  - Voice cache with 5 minute TTL per provider
  - Results capped at 20 with total count to prevent context bloat
- **VoicesNamespace** in ClawTalk SDK: `client.voices.list(provider?)` method
- 22 new tests for BotConfigTool

### Changed
- **Mission assistant voice inheritance**: `clawtalk_mission_setup_agent` no longer defaults to `Rime.ArcanaV3.astra`
  - If `voice` param omitted, server now uses user's `voice_preference` (with fallback to system default)
  - Explicit `voice` param still works for override
- Updated MissionTool schema description to reflect voice inheritance behavior

## [0.1.4] - 2026-03-16

### Removed
- `openclaw clawtalk config` CLI command (broken in non-TTY contexts, edit openclaw.json directly)
- `readlineSync` function and `tty` import (dead code after config removal)

### Changed
- Doctor/status messages now reference `plugins.entries.clawtalk.config` instead of removed config command

## [0.1.2] - 2026-03-13

### Added
- MissionObserver: background cron loop replaces heartbeat-driven polling
- Mission event handling via WebSocket (call_completed, call_failed, insights_ready, sms_delivered)
- SMS thread context injected into mission sessions
- Tool-level guardrails for mission lifecycle (state machine enforcement)
- Mission SKILL.md rewritten for webhook-driven architecture

### Changed
- Mission lifecycle is now fully event-driven (WebSocket push, observer as safety net)
- Loosened MissionObserver `collectActions` for edge cases

## [0.1.1] - 2026-03-11

### Added
- `openclaw clawtalk doctor` and `openclaw clawtalk config` CLI commands
- `openclaw clawtalk logs` for tailing WebSocket log

### Fixed
- Biome lint and formatting cleanup
- CI: use `npm install` for cross-version compatibility
- Replace `stty` with `tty.ReadStream` for portability

### Removed
- Install script (replaced by `openclaw plugins install`)

## [0.1.0] - 2026-03-09

Initial release.

### Added
- **Phase 1:** Plugin scaffold (openclaw.plugin.json, TypeScript, Biome, Vitest)
- **Phase 2:** ClawTalkClient SDK with Stripe-style namespaced API (calls, sms, missions, assistants, numbers, insights, approvals, doctor, user)
- **Phase 3:** Event handlers (CallHandler, DeepToolHandler, SmsHandler, WalkieHandler, ApprovalManager)
- **Phase 4:** 20 agent tools (7 communication, 11 mission, 2 standalone)
- **Phase 5:** MissionService with full lifecycle management, MissionEventHandler for real-time events
- **Phase 6:** Plugin entry point with CoreBridge (in-process agent execution), WebSocketService with persistent connection, health endpoint
- **Phase 7A:** GitHub Actions CI workflow, VoiceService, DoctorService
- PIN authentication for inbound calls
- Whitelist support for calls and SMS
- External caller tool blocking (whitelisted callbacks cannot invoke agent tools)
- WebSocket log file with API key redaction and rotation
- TypeBox schemas for all tool parameters
- 110+ tests across SDK, services, and tools
